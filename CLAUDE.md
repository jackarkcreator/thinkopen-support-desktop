# ThinkOpen Support Desktop — Project Operating Doc

**Canonical knowledge lives in git, not in any one machine's `~/.claude` memory. Read this file + `docs/STATE.md` before acting. `docs/STATE.md` = where the project is now; this file = how it works + rules that don't change. If a doc disagrees with live state, trust live state and fix the doc.**

---

## What it is

A thin **Electron shell** that wraps `support.thinkopen.net` so clients (and co-managed `org_admin` users like JC) get a branded desktop app instead of a browser tab. No server-side logic lives here — business logic, auth, and data all live in the web app (`~/Ccode/thinkopen-net`). The shell contributes:

- A frameless, navy-chrome window (`#0A2540`) that matches the Staff (Minka) app.
- The `window.minka` desktop bridge (sets `isDesktop: true`, exposes update/inventory/presence IPC) — the web app gates all desktop chrome on this flag.
- The **Koban device agent**: hardware/software/posture collection (`collectInventory`) + live presence reporting (`collectPresence`). Native primitives only — the web app owns entitlement checks and the authenticated POST.
- Auto-update via `electron-updater` pulling from GitHub Releases (checks 8s after launch + every 6h). Windows self-updates unsigned; macOS auto-update is gated on signing (currently a no-op until notarized).

## Stack

| Layer | Detail |
|---|---|
| **Runtime** | Electron 33 (`electron` devDep) |
| **Entry point** | `src/main.js` (package.json `"main": "src/main.js"`) |
| **Preload** | `src/preload.js` — exposes `window.minka` bridge via `contextBridge` |
| **Auto-update** | `electron-updater` ^6 — GitHub Releases feed (same repo) |
| **Device agent** | `systeminformation` ^5 — hardware/software/posture/presence collection |
| **Installer (Win)** | NSIS `oneClick:true`, per-user, silent updates, DPI-aware (`build/installer.nsh`) |
| **CI** | `.github/workflows/release.yml` — triggered on `v*` tags; matrix mac (universal dmg+zip) + win (x64 NSIS exe), serialized `max-parallel: 1` |
| **Distribution** | GitHub Releases at `github.com/jackarkcreator/thinkopen-support-desktop` (public repo) |
| **Web app loaded** | `https://support.thinkopen.net` (env override: `TO_SUPPORT_URL`) |

## Layout

| Path | What |
|---|---|
| `src/main.js` | All Electron logic: window, tray, IPC handlers, Koban agents, auto-update |
| `src/preload.js` | `window.minka` bridge — `isDesktop`, `app:"support"`, `platform`, update + inventory + presence IPC |
| `assets/trayTemplate.png` + `@2x` | Tray icon (template image, both resolutions) |
| `build/icon.icns` / `icon.png` | App icon (mac/win) |
| `build/installer.nsh` | NSIS DPI-awareness macro only (`ManifestDPIAware true` in `customHeader`) |
| `.github/workflows/release.yml` | CI release pipeline — builds + publishes on `v*` tag push |
| `package.json` | Electron-builder config, version, app ID (`net.thinkopen.support`), publish target |
| `main.js` (root) | **DEAD/STALE** — 123-line old artifact. The live entry is `src/main.js`. Do not edit. |
| `docs/STATE.md` | Current project state — update + commit each session |

## Hard rules

**Deploy / release:**
- Releases ship via CI only — tag `v<semver>`, push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`. Do not run `electron-builder --publish` locally (no Windows cross-build; CI handles both platforms).
- Push the **tag** explicitly — `git push --follow-tags` does NOT push lightweight tags. Use `git push origin vX.Y.Z` or make the tag annotated (`git tag -a`).
- Before cutting a release: `gh release list` to confirm no stale draft releases at or above the target version — a draft collision will cause the CI win job to fail silently (the loser of the create-release race hits 422 and drops its assets). This happened on v1.0.8.
- After a release: verify BOTH platform assets exist — `latest-mac.yml`, `latest.yml`, `*-mac-universal.dmg`, `*-mac-universal.zip`, `*-win-x64.exe` (plus `.blockmap` files). `gh run watch --exit-status` can return 0 even when a matrix leg failed, so check assets directly.
- Commit author for any deploy-bound commit must be `luis.ramos@thinkopen.net` (global rule; arqos/Vercel apps enforce this — Electron CI does not, but keep consistent).

**Koban agent rules:**
- Always use **absolute paths** for spawned system binaries in packaged Electron — `PATH` is stripped in a Finder/dock-launched app. mac: `/usr/sbin/system_profiler`, `/usr/bin/fdesetup`, `/usr/libexec/ApplicationFirewall/socketfilterfw`, `/usr/sbin/dsconfigad`. Relative binary names silently return empty. This burned us on the macOS software list (empty results until `@ee8a46a`).
- `src/main.js` is the **only** live main process file. The root `main.js` (123 lines) is a dead artifact from an early layout — do not edit it. `package.json "main"` points to `src/main.js`.
- `collectInventory` / `collectSoftware` / `collectPosture` / `collectPresence` degrade gracefully (resolve `null` or `[]` on any error) — they must never block the window load.
- `backgroundThrottling: false` is intentional — keeps the ~60s presence heartbeat firing while the window is hidden in the tray.

**Navy installer title bar — DO NOT RE-ATTEMPT:**
- Coloring the NSIS oneClick installer window navy was attempted and abandoned (v1.0.6–v1.0.7, deleted tags, 3 failed builds). The only correctly-timed NSIS hook (`customCheckAppRunning`) is a global replacement that must re-insert the default running-app check macro — which fails to compile the uninstaller in NSIS's separate pass. No guard fixes it. `build/installer.nsh` is DPI-awareness only; that is the settled stopping point.

**macOS auto-update:**
- `quitAndInstall()` fails on an unsigned/unnotarized Mac build. The `update-downloaded` handler in `src/main.js` explicitly skips macOS (`if (process.platform === "darwin") return`). Mac users must manually download new `.dmg` until signing lands. The web app's "Update ready" modal mirrors this gate. Do not remove the platform guard until the build is notarized.

**`window.minka` bridge contract:**
- The web app (`~/Ccode/thinkopen-net`) reads `window.minka.isDesktop`, `window.minka.app`, `window.minka.platform`, `window.minka.onUpdateReady`, `window.minka.installUpdate`, `window.minka.getInventory`, `window.minka.getPresence`. Changing any of these names requires a matching web deploy. The type declarations live in `thinkopen-net/src/types/minka-desktop.d.ts` — keep in sync.

**No `next dev` anywhere in `~/Ccode`:**
- This app does not run a dev server. Never run `next dev` / `npm run dev` in any `~/Ccode` app — Turbopack infers the workspace root as `/Users/synohash/Ccode` (a parent `package-lock.json` exists), watches all sibling apps + their `node_modules`, and has crashed the machine (128 GB RAM + 100 GB swap exhausted). Test the web app against prod or a Vercel preview URL, never localhost.

## Verify before done

| What changed | Minimum check |
|---|---|
| `src/main.js` / `src/preload.js` | `node --check src/main.js && node --check src/preload.js` |
| New release | All 8+ assets present in GitHub Release; `latest.yml` advertises the new version; `electron-updater` on the running old version detects it (relaunch to force 8s check) |
| Koban collection change | Test the collection fn directly in the running app (or a bare `node` probe); confirm null-degradation on platform not under test |
| Web bridge change | Deploy the web change first, confirm `window.minka.*` shape in `thinkopen-net/src/types/minka-desktop.d.ts` is current |
| NSIS config change | Fresh install on Keno's Windows VM (silent-update path does not show an installer window — only a fresh install triggers it) |
