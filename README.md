# Just Tab Reloader

A minimalist, lightweight, cross-browser extension (Chrome / Firefox, **Manifest V3**) that auto-refreshes tabs within a **randomized** time interval.

Useful for keeping sessions alive on firewalls, security portals, and monitoring dashboards that log you out when idle, or for watching pages that update over time (stock, inventory, announcements).

> 自動在隨機設定的時間區間內重新整理分頁，簡單、輕量、防斷線卡死。

## Features

- **Random intervals** — set a min/max seconds range; each reload picks a random value inside it, mimicking natural browsing. Last-used values are remembered.
- **Hard reload** — every refresh bypasses the cache (`bypassCache`) so you always see the latest content.
- **Per-tab settings** — enable reloaders on multiple tabs at once, each with independent timing.
- **Watchdog recovery** — a background alarm (every minute) detects and recovers reloaders that stalled after sleep, network drops, or load errors.
- **Auto-reopen on startup** *(opt-in)* — reopens previously-reloading tabs in the background when the browser restarts and resumes their cycles.
- **Privacy-first** — runs entirely locally. No tracking, no uploads. Stored data is limited to URL, title, and the min/max seconds (for restoration).
- **i18n** — English (`en`) and Traditional Chinese (`zh_TW`).

## Notes & limitations

- **Background-tab timing.** The countdown timer runs in the page (content script). Browsers heavily throttle timers in background (non-active) tabs, so a short interval (e.g. 30s) may not fire on time while the tab sits in the background — in practice it can stretch toward ~1 minute. The background watchdog still recovers stalled tabs, but it does not correct this drift. For precise short intervals, keep the tab in the foreground.
- **Restricted pages.** Browser-internal pages (`chrome://`, `about:`, the extensions store, etc.) cannot run content scripts; the popup disables its controls and shows a notice on those tabs.

## Project structure

```
manifest.json     # MV3 manifest (source / Chrome)
background.js     # Service worker: state, messaging, watchdog, startup restore
content.js        # Injected per page: countdown UI + reload trigger
utils.js          # Shared pure helpers (url match, validation, delay) — unit-tested
popup.html/js/css # Toolbar popup UI
_locales/         # i18n message catalogs (en, zh_TW)
icons/            # 48 / 96 / 128 px icons
build.js          # Builds dist/chrome and dist/firefox
test/             # node:test unit tests for utils.js
```

## Build

Requires Node.js. No dependencies.

```bash
npm run build      # or: node build.js
npm test           # run unit tests (node:test, no deps)
```

This regenerates `dist/chrome/` and `dist/firefox/` (the Firefox manifest is adapted automatically: `browser_specific_settings` + `background.scripts`).

## Load locally

- **Chrome** — `chrome://extensions` → enable *Developer mode* → *Load unpacked* → select `dist/chrome`.
- **Firefox** — `about:debugging` → *This Firefox* → *Load Temporary Add-on* → select any file in `dist/firefox`.

## Store Links

- **Chrome Web Store:** [Just Tab Reloader](https://chromewebstore.google.com/detail/just-tab-reloader)
- **Firefox Add-ons (AMO):** [Just Tab Reloader](https://addons.mozilla.org/firefox/addon/just-tab-reloader/)

## License

MIT
