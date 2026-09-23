# Lulltab

A memory saver for [Aside](https://aside.ai), Chrome, and other Chromium browsers. Idle tabs go to sleep; click one and it wakes.

**Website:** https://lulltab.n3el.dev ·
**Download:** [lulltab.zip](https://github.com/neelsatyavolu/lulltab/releases/latest/download/lulltab.zip) ·
**License:** [MIT](LICENSE)

Lulltab uses the browser’s native **tab discard**. The tab stays in the strip. The page unloads from memory. Coming back reloads it.

## Install from a release

1. Download [`lulltab.zip`](https://github.com/neelsatyavolu/lulltab/releases/latest/download/lulltab.zip) and unzip it.
2. Open `chrome://extensions` (or `aside://extensions`) and turn on **Developer mode**.
3. **Load unpacked** → the unzipped `lulltab` folder.

## Load from source

There’s no build step. Clone the repo and **Load unpacked** → the repo folder.

## What it does

- Sleeps tabs after a timeout you set (default 15 minutes)
- Restores a tab the moment you activate it
- Whitelist domains, exact hosts, subdomains, paths, and URL prefixes
- Skips pinned tabs, audible tabs, and browser pages
- Popup: sleep now, keep this site, wake sleeping tabs
- Memory tab: RAM per loaded tab (sleeping tabs show as unloaded)
- Debug mode: event log, API probes, copy-a-report
- Right-click: Sleep this tab / Never sleep this site
- Shortcut: `Alt+Shift+S` sleeps the current tab

## Debug

Turn on **Debug mode** in settings, or click the **Lulltab** wordmark in the popup five times. The Debug tab shows whether the RAM API, alarms, and menus are available, plus a rolling event log. **Copy report** dumps JSON you can paste when something breaks.

## Whitelist patterns

| You type | Matches |
| --- | --- |
| `github.com` | github.com and every subdomain |
| `=mail.google.com` | only that host |
| `*.notion.so` | subdomains, not notion.so itself |
| `github.com/neel` | that path and below |
| `https://mail.google.com/mail` | URLs with that prefix |

## Develop

```bash
npm test
```

Open `popup/popup.html` or `options/options.html` in a browser for a UI preview (demo data).

`site/` is the static landing page, deployed on Vercel (project root: `site`).
`store/` holds the Chrome Web Store listing: description, permission justifications, screenshots, and promo tiles.
Web Store item ID: `koilonckhflgomjkphaoehnheeplagfj`.

## License

[MIT](LICENSE). Found a security issue? See [SECURITY.md](SECURITY.md).
