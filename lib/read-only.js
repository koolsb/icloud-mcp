// ICLOUD_MCP_READ_ONLY=1: hard read-only mode.
//
// Three independent guards, so a bug in any single tool cannot change the account:
//   1. IMAP: every mailbox is opened read-only (EXAMINE) and every mutating
//      ImapFlow method throws before a command is sent.
//   2. CalDAV/CardDAV: only safe HTTP methods (GET, HEAD, OPTIONS, PROPFIND,
//      REPORT) are allowed; PUT/DELETE/MKCALENDAR/PROPPATCH/... throw.
//   3. Tools: the tool profile is forced to `read-only`, an allowlist of tools
//      that only read. Anything else is hidden from tools/list and rejected.
// SMTP is forced off as well (see getSendMode in smtp.js).

export class ReadOnlyError extends Error {
  constructor(what) {
    super(`Read-only mode (ICLOUD_MCP_READ_ONLY): ${what} is not allowed. Nothing was changed.`);
    this.name = 'ReadOnlyError';
    this.code = 'read_only';
  }
}

export function isReadOnly(env = process.env) {
  const raw = String(env.ICLOUD_MCP_READ_ONLY ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

// Every ImapFlow method that can change server state.
export const IMAP_MUTATING_METHODS = [
  'append',
  'mailboxCreate', 'mailboxRename', 'mailboxDelete',
  'mailboxSubscribe', 'mailboxUnsubscribe',
  'messageDelete', 'messageMove', 'messageCopy',
  'messageFlagsAdd', 'messageFlagsRemove', 'messageFlagsSet',
  'setFlagColor', 'messageFlagsSetColor',
];

export function guardImapClient(client, env = process.env) {
  if (!client || !isReadOnly(env)) return client;
  if (typeof client.mailboxOpen === 'function') {
    const open = client.mailboxOpen.bind(client);
    client.mailboxOpen = (path, options = {}) => open(path, { ...options, readOnly: true });
  }
  if (typeof client.getMailboxLock === 'function') {
    const lock = client.getMailboxLock.bind(client);
    client.getMailboxLock = (path, options = {}) => lock(path, { ...options, readOnly: true });
  }
  for (const method of IMAP_MUTATING_METHODS) {
    if (typeof client[method] === 'function') {
      client[method] = async () => { throw new ReadOnlyError(`IMAP ${method}`); };
    }
  }
  return client;
}

export const DAV_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PROPFIND', 'REPORT']);

export function assertDavMethodAllowed(method, env = process.env) {
  if (!isReadOnly(env)) return;
  const m = String(method ?? '').toUpperCase();
  if (!DAV_SAFE_METHODS.has(m)) throw new ReadOnlyError(`DAV ${m || '(empty)'} request`);
}

// Tools that only read. Reminders are omitted: they shell out to osascript
// (macOS only) and are unusable in a Linux container.
export const READ_ONLY_TOOLS = [
  // Mail
  'list_accounts', 'list_mailboxes', 'get_inbox_summary', 'get_mailbox_summary',
  'read_inbox', 'get_email', 'get_email_raw', 'get_thread', 'search_emails',
  'count_emails', 'get_emails_by_sender', 'get_emails_by_date_range',
  'get_top_senders', 'get_unread_senders', 'list_attachments', 'get_attachment',
  'get_unsubscribe_info', 'get_storage_report', 'list_rules',
  // Calendar
  'list_calendars', 'list_events', 'list_events_multi', 'get_event',
  'search_events', 'detect_conflicts', 'suggest_event_from_email',
  // Contacts
  'list_contacts', 'search_contacts', 'get_contact',
];
