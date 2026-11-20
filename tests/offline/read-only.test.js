// koolsb fork: ICLOUD_MCP_READ_ONLY hard read-only mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const root = mkdtempSync(join(tmpdir(), 'icloud-mcp-ro-'));
process.env.ICLOUD_MCP_DATA_DIR = root;
process.env.ICLOUD_MCP_AUDIT_LOG = join(root, 'audit.log');
process.env.ICLOUD_MCP_READ_ONLY = '1';
process.env.IMAP_USER = 'test@icloud.com';
process.env.IMAP_PASSWORD = 'not-a-real-password';

const ro = await import('../../lib/read-only.js');
const { resolveToolProfile, selectTools, prepareToolCall } = await import('../../lib/tool-profile.js');
const { getSendMode } = await import('../../lib/smtp.js');
const imap = await import('../../lib/imap.js');
const caldav = await import('../../lib/caldav.js');
const carddav = await import('../../lib/carddav.js');

function fakeImapClient() {
  const calls = [];
  const client = {
    calls,
    async connect() { calls.push(['connect']); },
    async logout() { calls.push(['logout']); },
    close() {},
    on() {},
    async mailboxOpen(path, options) { calls.push(['mailboxOpen', path, options]); return { exists: 1, path }; },
    async getMailboxLock(path, options) { calls.push(['getMailboxLock', path, options]); return { release() {} }; },
  };
  for (const m of ro.IMAP_MUTATING_METHODS) {
    client[m] = async (...args) => { calls.push([m, ...args]); return true; };
  }
  return client;
}

test('isReadOnly accepts the usual truthy spellings only', () => {
  for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) assert.equal(ro.isReadOnly({ ICLOUD_MCP_READ_ONLY: v }), true, v);
  for (const v of [undefined, '', '0', 'false', 'no', 'off']) assert.equal(ro.isReadOnly({ ICLOUD_MCP_READ_ONLY: v }), false, String(v));
});

test('guardImapClient forces read-only opens and blocks every mutating method', async () => {
  const client = ro.guardImapClient(fakeImapClient());
  await client.mailboxOpen('INBOX');
  await client.mailboxOpen('Archive', { readOnly: false });
  await client.getMailboxLock('INBOX', { readOnly: false });
  for (const m of ro.IMAP_MUTATING_METHODS) {
    await assert.rejects(() => client[m]('x'), { code: 'read_only' }, m);
  }
  assert.deepEqual(client.calls, [
    ['mailboxOpen', 'INBOX', { readOnly: true }],
    ['mailboxOpen', 'Archive', { readOnly: true }],
    ['getMailboxLock', 'INBOX', { readOnly: true }],
  ]);
});

test('guardImapClient is a no-op when read-only is off', async () => {
  const client = ro.guardImapClient(fakeImapClient(), {});
  await client.mailboxOpen('INBOX');
  await client.messageFlagsAdd([1], ['\\Seen']);
  assert.deepEqual(client.calls.map((c) => c[0]), ['mailboxOpen', 'messageFlagsAdd']);
  assert.equal(client.calls[0][2], undefined);
});

test('IMAP clients created by the library are guarded (flag_email cannot write)', async () => {
  let made;
  imap.setImapClientFactory(() => { made = fakeImapClient(); return made; });
  try {
    await assert.rejects(() => imap.flagEmail(42, true, 'INBOX'), { code: 'read_only' });
    assert.ok(made.calls.every((c) => !ro.IMAP_MUTATING_METHODS.includes(c[0])), JSON.stringify(made.calls));
    const opens = made.calls.filter((c) => c[0] === 'mailboxOpen');
    assert.ok(opens.length > 0 && opens.every((c) => c[2]?.readOnly === true));
  } finally {
    imap.setImapClientFactory(null);
  }
});

test('DAV guard allows only safe methods', () => {
  for (const m of ['GET', 'head', 'OPTIONS', 'PROPFIND', 'REPORT']) ro.assertDavMethodAllowed(m);
  for (const m of ['PUT', 'DELETE', 'MKCALENDAR', 'PROPPATCH', 'MOVE', 'COPY', 'POST', '']) {
    assert.throws(() => ro.assertDavMethodAllowed(m), { code: 'read_only' }, m);
  }
});

test('CalDAV and CardDAV never send a mutating request', async () => {
  const seen = [];
  const fake = async (method, url) => { seen.push(method); return { status: 207, etag: null, body: '<multistatus xmlns="DAV:"/>' }; };
  caldav.setCalDavRequestForTests(fake);
  carddav.setCardDavRequestForTests(fake);
  try {
    await assert.rejects(() => caldav.createEvent('cal', { summary: 'x', start: '2026-01-01T10:00:00Z', end: '2026-01-01T11:00:00Z' }));
    await assert.rejects(() => caldav.deleteEvent('cal', 'evt'));
    await assert.rejects(() => carddav.createContact({ firstName: 'A' }));
    const writes = seen.filter((m) => !ro.DAV_SAFE_METHODS.has(m));
    assert.deepEqual(writes, [], `mutating DAV methods reached the transport: ${writes}`);
  } finally {
    caldav.setCalDavRequestForTests(null);
    carddav.setCardDavRequestForTests(null);
  }
});

test('read-only forces the tool profile and hides write tools', () => {
  assert.equal(resolveToolProfile({ ICLOUD_MCP_READ_ONLY: '1', ICLOUD_MCP_TOOL_PROFILE: 'full' }), 'read-only');
  const tools = ['get_email', 'delete_email', 'compose_email', 'list_events', 'create_event', 'search_contacts', 'create_contact']
    .map((name) => ({ name }));
  assert.deepEqual(selectTools(tools).map((t) => t.name), ['get_email', 'list_events', 'search_contacts']);
  assert.throws(() => prepareToolCall('delete_email', {}), /read-only tool profile/);
  assert.throws(() => prepareToolCall('save_draft', {}), /read-only tool profile/);
  assert.deepEqual(prepareToolCall('get_email', { uid: 1 }), { uid: 1 });
});

test('read-only forces sending off', () => {
  assert.equal(getSendMode({ ICLOUD_MCP_READ_ONLY: '1', ICLOUD_MCP_SEND_MODE: 'on' }), 'off');
});
