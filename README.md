# ThinkOpen Support — Desktop App

A thin [Electron](https://www.electronjs.org/) shell around the ThinkOpen client
support portal at **support.thinkopen.net**. It gives clients (and co-managed
`org_admin` users) a clean, branded desktop app instead of a browser tab — the
server decides by role what each user sees (clients → ticket portal; org admins →
their org-scoped admin view).

Chrome matches the Staff **Minka** app: a frameless window with the macOS traffic
lights inset over a navy `#0A2540` title bar that the web app paints itself.

The shell contains no secrets — it only loads a public URL and exposes a tiny
desktop bridge (`window.minka.isDesktop`).

## Develop

```bash
npm install
npm start
```

## Build installers

```bash
npm run dist        # macOS universal .dmg/.zip
npm run dist:win    # Windows NSIS .exe (needs a Windows host or CI)
```

CI (`.github/workflows/release.yml`) builds macOS + Windows and publishes to this
repo's **Releases** (the public auto-update feed) on any `v*` tag. Builds are
currently **unsigned**.

## Distribution

Installers are linked from the `/download` page on thinkopen.net (OS auto-detect).
Auto-update is wired via `electron-updater` against this repo's Releases.

© ThinkOpen Inc.
