# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, use
GitHub's private reporting: **Security → Report a vulnerability** on this
repository. You'll get a response within a few days.

## What Lulltab handles

- Lulltab makes no network requests. There is no Lulltab server.
- Settings and the whitelist are stored in `chrome.storage.local`; per-session
  tab timestamps in `chrome.storage.session`.
- The `scripting` permission is used only to read a page's JS heap size
  (`performance.memory`) for the Memory view when per-process memory isn't
  available.
