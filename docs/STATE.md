# ThinkOpen Support Desktop — Current State

> **Living doc.** Update this at the end of any session that changes the project, then commit. It round-trips between machines via git — it is how office-Claude and travel-Claude stay in sync. Keep it short and current; move durable rules to `CLAUDE.md`.

**Last updated:** 2026-06-15 · **Branch:** `main` · **HEAD SHA:** `8b65e51`
**Distribution:** GitHub Releases at `github.com/jackarkcreator/thinkopen-support-desktop` (public repo, electron-updater auto-update feed). **Current version: v1.0.14.**

---

## Where we are

**All shipped, CI green, Keno-verified:**

- **v1.0.0** (`2026-06-04`) — first release; universal mac dmg + win x64 NSIS exe; navy frameless window; `window.minka` bridge; `isDesktop` flag lights up portal chrome with zero web changes; co-managed routing proven (JC → org-admin admin shell).
- **v1.0.1** — Windows navy titleBarOverlay + branded "Update ready" modal (web-side modal, shell exposes bridge).
- **v1.0.2** — silent NSIS oneClick installer (no wizard on every update); friendly update modal copy.
- **v1.0.3** — branded in-app "Update ready" modal end-to-end (Keno verified v1.0.2→v1.0.3 silent hop on Windows).
- **v1.0.4** — DPI-aware installer (`build/installer.nsh`, `ManifestDPIAware true`); no navy installer bar (abandoned — hard NSIS limit, see `CLAUDE.md`).
- **v1.0.5** — same DPI fix, clean release above stale draft collision.
- **v1.0.8** (`@697ffb9`) — Koban inventory agent: `collectInventory` (hardware/software via `systeminformation`), `window.minka.getInventory` IPC bridge, `KobanAgent` web component orchestrates entitlement + POST. CI race mitigated (`max-parallel: 1`, `@f65f328`). macOS software collection uses absolute `/usr/sbin/system_profiler` path (`@ee8a46a`) — was silently empty before.
- **v1.0.9** (`@7ac64d1`) — Koban presence agent: `collectPresence` (`powerMonitor` idle/lock), `window.minka.getPresence` IPC, `DesktopActivityGate` first-run disclosure, tray-resident (hides to tray on window close instead of quitting), `backgroundThrottling: false`, autostart default ON at first launch.
- **v1.0.10** (`@5900b1f`) — expanded hardware/network fields: `localIp`, `primaryMac`, `manufacturer`, `model`, `biosVersion`, `biosVendor`, `bootTime`, `timezone` via `systeminformation`. Drawer Network + Hardware rows now populate.
- **v1.0.11** (`@73b3314`) — Koban security posture agent: `collectPosture()` — FileVault/BitLocker, firewall, AD domain, reboot-pending. Maps to cyber-insurance questionnaire fields. macOS: absolute paths for `fdesetup`, `socketfilterfw`, `dsconfigad`. Windows: single PowerShell JSON blob. Degrades to `null` per field on any failure.
- **v1.0.12** (`@1fa4947`) — fix double taskbar icon on Windows: `app.setAppUserModelId("net.thinkopen.support")` before window create matches the NSIS shortcut AUMID.
- **v1.0.13** (`@509bd2e`) — pre-warm inventory at app startup (5-min TTL cache via `warmInventory()`); `DeviceIdentity` header chip on the portal paints at first load instead of after a multi-second WMI enumeration.
- **v1.0.14** (`@8b65e51`) — tray "Check for Updates…" with explicit feedback (downloading/up-to-date/failed dialogs; mac → "Open Download Page"); "About ThinkOpen Support (vX.Y.Z)" inline in the tray menu label + dialog.

**Web app (ships independently via Vercel — no shell rebuild needed):**
- Client portal big-bang overhaul live at `support.thinkopen.net`: one-box AI intake (Haiku triage), AI first-aid card, live ticket thread with Supabase Realtime, SupportShell shared layout (no per-page remount jank), synchronized CSS desktop detection.
- Client desktop notifications: engineer public comment → OS toast (opt-in bell). Realtime channel uses unique-per-mount topic name (avoid supabase-ssr singleton channel-reuse bug).

## In flight / not done

- **macOS auto-update** — gated on signing/notarization. Mac users must manually download new `.dmg` from Releases. The `update-downloaded` handler in `src/main.js` is platform-gated off until signed. Code is ready; unblocked by Keno buying Apple Developer org enrollment.
- **Windows code signing** — Azure Trusted Signing (~$9.99/mo) deferred by Keno. Currently shows "Unknown Publisher" SmartScreen on first install.
- **Client portal desktop notifications** — shipped in web app (Task 8, `@5bd99ac`). Verify Keno's end-to-end (native toast → click → focus + open ticket).
- **Koban domain/VPN fields** (`devices.domain`, `devices.vpn_active`) — DB columns provisioned (mig 085), drawer rows show "—". Agent collection not yet built (VPN = heuristic on utun/WireGuard adapters; deferred).

## Next up

- Code signing (Windows first, then macOS notarize — enables mac auto-update and removes SmartScreen warning).
- Enable Koban inventory for JC/TRC orgs (`activity_enabled=true` pending client disclosure verification).
- Phase 2 Koban lifecycle (stale/archive/billing-banner in the web app `/admin/devices`).

## Open questions

- Keno: verify Koban v1.0.10+ drawer fields populate on Windows VM (localIp/MAC/model/BIOS/uptime/tz).
- Keno: verify Koban presence flows after VM auto-updates to v1.0.9+ — `device_presence` rows + Session column in `/admin/devices`.
- macOS software list fix (absolute path, `@ee8a46a`) is committed but tagged only in release bumps — ships on the next signed build (option B, deferred with Keno).

## How to verify / build

```bash
# Syntax-check the shell code
node --check src/main.js && node --check src/preload.js

# Local start (mac only — win needs the CI)
npm start

# Cut a release (triggers CI → GitHub Releases → electron-updater feed)
# ALWAYS check for stale drafts first:
gh release list
git tag vX.Y.Z && git push origin vX.Y.Z   # lightweight tag — must push by name
# After CI: confirm BOTH platform assets exist (latest.yml + latest-mac.yml +
# *-mac-universal.dmg/.zip + *-win-x64.exe + .blockmap files)
```

Auto-update timing: running app checks 8s after launch + every 6h. Tray "Check for Updates…" triggers on demand. Windows auto-installs silently; macOS shows "Open Download Page" until signed.
