# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, use
GitHub's private reporting: **Security → Report a vulnerability** on this
repository. You'll get a response within a few days.

## What Lulltab handles

- Lulltab's only network request is an optional, anonymous daily ping to
  `analytics.n3el.dev` (random install ID, Lulltab and Chrome versions, CPU
  type). It's off when **Share anonymous usage stats** is unchecked in
  settings. Tab data never leaves the browser.
- Settings and the whitelist are stored in `chrome.storage.local`; per-session
  tab timestamps in `chrome.storage.session`.
- The `scripting` permission is used only to read a page's JS heap size
  (`performance.memory`) for the Memory view when per-process memory isn't
  available.
