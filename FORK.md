# koolsb/icloud-mcp — fork notes

Fork of [adamzaidi/icloud-mcp](https://github.com/adamzaidi/icloud-mcp), reviewed at
upstream `129c718` (v2.8.0), packaged as `ghcr.io/koolsb/icloud-mcp` to run in a home
Kubernetes cluster behind an Authentik-authenticated MCP gateway.

## Changes from upstream

- **`ICLOUD_MCP_READ_ONLY=1`** (`lib/read-only.js`), hard read-only mode, three
  independent guards:
  1. IMAP: every mailbox opened read-only (`EXAMINE`); every mutating ImapFlow method
     (`append`, `mailbox{Create,Rename,Delete,...}`, `message{Delete,Move,Copy,Flags*}`)
     throws before a command is sent — including the drafts client in `smtp.js`.
  2. CalDAV/CardDAV: only `GET`/`HEAD`/`OPTIONS`/`PROPFIND`/`REPORT` reach the network.
  3. Tool profile forced to `read-only` (allowlist in `READ_ONLY_TOOLS`); SMTP send mode
     forced `off`. Reminders are excluded (macOS `osascript` only).
- **`ICLOUD_MCP_HTTP_HOST`**: HTTP bind address (default `127.0.0.1`, unchanged).
- `Dockerfile` (non-root, read-only defaults) and a GHCR multi-arch publish workflow
  that runs the offline tests first.
- Tests: `tests/offline/read-only.test.js`.

## Updating from upstream

Review the upstream diff before merging (`git fetch upstream && git log -p HEAD..upstream/main`),
re-run `npm test`, and check any new tool against `READ_ONLY_TOOLS`.
