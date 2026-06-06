// ThinkOpen Support — thin Electron shell around the client support portal.
// Loads support.thinkopen.net so clients (and co-managed org admins) get a
// clean, branded app instead of a browser tab.
//
// Chrome matches the Staff (Minka) app for brand consistency: a frameless
// window with the macOS traffic lights inset over a navy (#0A2540) title bar
// that the WEB APP paints itself. login / portal / org-admin admin all render
// their navy bar gated to `window.minka.isDesktop`; the preload sets that flag
// (we reuse Minka's desktop bridge contract verbatim), so login + the org-admin
// admin shell light up with zero web changes and the client portal shell adds
// its own. backgroundColor is navy so the load flash is navy, not the old teal.

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  shell,
  ipcMain,
  nativeImage,
  powerMonitor,
  dialog,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { autoUpdater } = require("electron-updater");
const si = require("systeminformation");

// ---- Koban inventory agent (data-collection primitive) --------------------
// Mirrors the Staff (Minka) app. The web app (window.minka.getInventory)
// orchestrates entitlement + the authenticated POST; this just gathers a
// one-shot device snapshot. Installed-software collection degrades to [] on any
// failure so the hardware report always goes through. See project_koban.
function collectSoftware() {
  return new Promise((resolve) => {
    const opts = { timeout: 25000, maxBuffer: 64 * 1024 * 1024 };
    try {
      if (process.platform === "darwin") {
        // Absolute path: a Finder/dock-launched macOS app gets a stripped PATH,
        // so the bare command name can fail to resolve (silent empty list). The
        // command itself is fast (~1s) — the relative lookup was the gap.
        execFile("/usr/sbin/system_profiler", ["SPApplicationsDataType", "-json"], opts, (err, stdout) => {
          if (err) return resolve([]);
          try {
            const apps = (JSON.parse(stdout).SPApplicationsDataType || [])
              .map((a) => ({ name: a._name, version: a.version || null }))
              .filter((a) => a.name);
            resolve(apps.slice(0, 2000));
          } catch { resolve([]); }
        });
      } else if (process.platform === "win32") {
        const ps =
          "Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'," +
          "'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' " +
          "| Where-Object {$_.DisplayName} | Select-Object DisplayName,DisplayVersion | ConvertTo-Json -Compress";
        execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], opts, (err, stdout) => {
          if (err) return resolve([]);
          try {
            let arr = JSON.parse(stdout);
            if (!Array.isArray(arr)) arr = [arr];
            const apps = arr
              .map((a) => ({ name: a.DisplayName, version: a.DisplayVersion || null }))
              .filter((a) => a.name);
            resolve(apps.slice(0, 2000));
          } catch { resolve([]); }
        });
      } else {
        resolve([]);
      }
    } catch {
      resolve([]);
    }
  });
}

// Run a system binary and resolve its trimmed stdout (or null on any failure /
// timeout). Absolute paths only — a packaged app has a stripped PATH.
function shOut(cmd, args, timeout = 9000) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout, maxBuffer: 1 << 20 }, (err, stdout) => resolve(err ? null : (stdout || "").trim()));
    } catch {
      resolve(null);
    }
  });
}

// Security posture + domain join — the "is this machine safe?" signals. All
// read-only, no-admin, fast, OS-native; each degrades to null (= "unknown") so a
// missing tool never blocks the inventory report. See project_koban.
async function collectPosture() {
  const none = { domain: null, diskEncrypted: null, firewallEnabled: null, rebootPending: null };
  try {
    if (process.platform === "darwin") {
      const [fv, fw, ad] = await Promise.all([
        shOut("/usr/bin/fdesetup", ["status"]),                                                    // FileVault
        shOut("/usr/libexec/ApplicationFirewall/socketfilterfw", ["--getglobalstate"]),            // firewall
        shOut("/usr/sbin/dsconfigad", ["-show"]),                                                  // AD bind
      ]);
      let domain = null;
      if (ad) { const m = ad.match(/Active Directory Domain\s*=\s*(\S+)/i); if (m) domain = m[1]; }
      return {
        domain,
        diskEncrypted: fv == null ? null : /FileVault is On/i.test(fv),
        firewallEnabled: fw == null ? null : /enabled|State = [12]/i.test(fw),
        rebootPending: null, // not a meaningful concept on macOS
      };
    }
    if (process.platform === "win32") {
      const ps =
        "$d=(Get-CimInstance Win32_ComputerSystem).Domain;" +
        "$enc=$null; try { $enc=((Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop).ProtectionStatus -eq 'On') } catch {};" +
        "$fw=$null; try { $fw=[bool]((Get-NetFirewallProfile -ErrorAction Stop | Where-Object {$_.Enabled}).Count -gt 0) } catch {};" +
        "$rb=(Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending') -or " +
        "(Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired');" +
        "[pscustomobject]@{domain=$d;enc=$enc;fw=$fw;reboot=$rb} | ConvertTo-Json -Compress";
      const out = await shOut("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], 12000);
      if (!out) return none;
      const j = JSON.parse(out);
      const wgIsWorkgroup = typeof j.domain === "string" && /^workgroup$/i.test(j.domain);
      return {
        domain: j.domain ? (wgIsWorkgroup ? "WORKGROUP" : j.domain) : null,
        diskEncrypted: typeof j.enc === "boolean" ? j.enc : null,
        firewallEnabled: typeof j.fw === "boolean" ? j.fw : null,
        rebootPending: typeof j.reboot === "boolean" ? j.reboot : null,
      };
    }
  } catch {
    /* degrade */
  }
  return none;
}

async function collectInventory() {
  const [uuidData, sys, cpu, mem, osInfo, disks, users, bios, netIfaces, defaultIface, posture, software] = await Promise.all([
    si.uuid().catch(() => ({})),
    si.system().catch(() => ({})),
    si.cpu().catch(() => ({})),
    si.mem().catch(() => ({})),
    si.osInfo().catch(() => ({})),
    si.diskLayout().catch(() => []),
    si.users().catch(() => []),
    si.bios().catch(() => ({})),
    si.networkInterfaces().catch(() => []),
    si.networkInterfaceDefault().catch(() => null),
    collectPosture(),
    collectSoftware(),
  ]);

  const hardwareUuid = uuidData.hardware || sys.uuid || uuidData.os || os.hostname();
  const diskBytes = (disks || []).reduce((n, d) => n + (d.size || 0), 0) || null;
  const cpuModel = `${cpu.manufacturer || ""} ${cpu.brand || ""}`.trim() || null;
  const osVersion =
    process.platform === "darwin"
      ? (osInfo.release || null)
      : `${(osInfo.distro || "").replace(/Microsoft Windows/i, "").trim()}${osInfo.build ? ` (${osInfo.build})` : ""}`.trim() || (osInfo.release || null);
  const osUser = (users && users[0] && users[0].user) || os.userInfo().username || null;

  // Network: prefer the OS's default interface; fall back to the first active,
  // non-internal IPv4 interface. Yields the LAN IPv4 + the primary MAC.
  const ifaces = Array.isArray(netIfaces) ? netIfaces : netIfaces ? [netIfaces] : [];
  const primaryIface =
    ifaces.find((n) => n && n.iface === defaultIface && n.ip4) ||
    ifaces.find((n) => n && !n.internal && n.ip4 && n.operstate !== "down") ||
    ifaces.find((n) => n && !n.internal && n.ip4) ||
    null;
  const localIp = (primaryIface && primaryIface.ip4) || null;
  const primaryMac = (primaryIface && primaryIface.mac) || null;

  // Uptime → a STABLE boot instant (one-shot snapshot: store the moment, not a
  // number that's stale the second the server reads it). si.time() is sync.
  const t = si.time() || {};
  const uptimeSec = typeof t.uptime === "number" ? t.uptime : null;
  const bootTime = uptimeSec != null ? new Date(Date.now() - uptimeSec * 1000).toISOString() : null;
  let timezone = null;
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { /* fall back */ }
  if (!timezone) timezone = t.timezone || null;

  return {
    hardwareUuid,
    serial: sys.serial || null,
    hostname: os.hostname() || null,
    platform: process.platform,
    osVersion,
    cpuModel,
    cpuCount: cpu.physicalCores || cpu.cores || null,
    ramBytes: mem.total || null,
    diskBytes,
    lastOsUser: osUser,
    appVersion: app.getVersion(),
    // Network identity
    localIp,
    primaryMac,
    // Hardware identity
    manufacturer: sys.manufacturer || null,
    model: sys.model || null,
    biosVersion: bios.version || null,
    biosVendor: bios.vendor || null,
    // Lifecycle
    bootTime,
    timezone,
    // Security posture + domain join
    domain: posture.domain,
    diskEncrypted: posture.diskEncrypted,
    firewallEnabled: posture.firewallEnabled,
    rebootPending: posture.rebootPending,
    software,
  };
}

// ---- Koban presence agent (live session/activity primitive) ---------------
// Reports the current login session: who's logged in, when the session began
// (process start ≈ login when autostarted), how long they've been idle, and
// whether the screen is locked. powerMonitor gives OS-truth idle/lock. The web
// app gates on the `activity` entitlement + a one-time disclosure and owns the
// authenticated POST (~60s). See project_koban.
const SESSION_STARTED_AT = new Date(); // process start ≈ login when autostarted

// hardware_uuid is our device identity; it never changes for the life of the
// process, so resolve it once (si.uuid is comparatively heavy) and cache it.
let cachedHardwareUuid = null;
async function getHardwareUuid() {
  if (cachedHardwareUuid) return cachedHardwareUuid;
  try {
    const [uuidData, sys] = await Promise.all([
      si.uuid().catch(() => ({})),
      si.system().catch(() => ({})),
    ]);
    cachedHardwareUuid = uuidData.hardware || sys.uuid || uuidData.os || os.hostname();
  } catch {
    cachedHardwareUuid = os.hostname();
  }
  return cachedHardwareUuid;
}

async function collectPresence() {
  const hardwareUuid = await getHardwareUuid();
  let idleSeconds = null;
  let lockState = "unknown"; // 'active' | 'idle' | 'locked' | 'unknown'
  try { idleSeconds = powerMonitor.getSystemIdleTime(); } catch { /* unsupported */ }
  try { lockState = powerMonitor.getSystemIdleState(300); } catch { /* unsupported */ } // 5-min idle threshold
  let osUser = null;
  try { osUser = os.userInfo().username || null; } catch { /* non-fatal */ }
  return {
    hardwareUuid,
    osUser,
    sessionStartedAt: SESSION_STARTED_AT.toISOString(),
    idleSeconds,
    lockState,
    platform: process.platform,
    hostname: os.hostname() || null,
    appVersion: app.getVersion(),
  };
}

// Persistent activity-monitoring disclosure (the "always available" half of the
// first-run notice the web app shows). Reachable any time from the tray so the
// monitored user can re-read exactly what is collected and why.
const ACTIVITY_DISCLOSURE =
  "When your organization enables Koban activity monitoring, this app reports " +
  "your device's session presence to your IT administrators: the signed-in " +
  "username, when the session started, how long the device has been idle, and " +
  "whether the screen is locked. It does NOT capture keystrokes, screen " +
  "contents, browsing, or file activity. The data is used for IT support, " +
  "utilization, and billing accuracy. Questions? Contact your IT administrator.";
function showActivityDisclosure() {
  dialog.showMessageBox({
    type: "info",
    title: "Privacy & Activity Monitoring",
    message: "Koban activity monitoring",
    detail: ACTIVITY_DISCLOSURE,
    buttons: ["OK"],
  });
}

// Auto-update pulls from the app's public GitHub Releases feed (configured in
// package.json build.publish). Windows (NSIS) self-updates even unsigned; macOS
// auto-update requires a signed/notarized build, so until we sign it the mac
// check is a logged no-op (errors are swallowed below, never fatal).
function initAutoUpdates() {
  autoUpdater.autoDownload = true;
  autoUpdater.on("error", (err) => {
    console.warn("[autoUpdater]", err == null ? "unknown error" : err.message || err);
  });

  // When a new version finishes downloading, tell the web app so it can show its
  // branded "Update ready" modal. Skip macOS until the build is signed/notarized
  // — quitAndInstall() fails on an unsigned mac, so we don't surface a button
  // that can't work; the modal lights up on mac automatically once we sign.
  autoUpdater.on("update-downloaded", (info) => {
    if (process.platform === "darwin") return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("minka:update-ready", {
        version: info && info.version,
        releaseName: info && info.releaseName,
        releaseNotes:
          info && typeof info.releaseNotes === "string" ? info.releaseNotes : null,
      });
    }
  });

  // "Install & Restart" from the modal → close, install, relaunch on the new
  // version. setImmediate lets the IPC reply flush before the app quits.
  ipcMain.handle("minka:install-update", () => {
    setImmediate(() => autoUpdater.quitAndInstall());
  });

  // Koban: the web app asks for a device snapshot; failures resolve null.
  ipcMain.handle("minka:get-inventory", async () => {
    try {
      return await collectInventory();
    } catch (err) {
      console.warn("[koban] inventory collection failed:", err && err.message);
      return null;
    }
  });

  // Koban: the web app asks for a live presence snapshot (~60s); failures → null.
  ipcMain.handle("minka:get-presence", async () => {
    try {
      return await collectPresence();
    } catch (err) {
      console.warn("[koban] presence collection failed:", err && err.message);
      return null;
    }
  });

  // We own the update UI now, so checkForUpdates (not ...AndNotify, which would
  // also pop a native OS notification and double up with the modal).
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 8000);
  setInterval(check, 6 * 60 * 60 * 1000);
}

const APP_URL = process.env.TO_SUPPORT_URL || "https://support.thinkopen.net";

// Hosts kept INSIDE the window (portal + identity providers). Everything else
// opens in the user's default browser.
const INTERNAL_HOSTS = [
  "support.thinkopen.net",
  "staff.thinkopen.net",
  "thinkopen.net",
  "login.microsoftonline.com",
  "login.live.com",
  "login.windows.net",
  "accounts.google.com",
];
const isInternalHost = (urlStr) => {
  try {
    const h = new URL(urlStr).hostname;
    return INTERNAL_HOSTS.some((d) => h === d || h.endsWith("." + d));
  } catch {
    return false;
  }
};

const stateFile = () => path.join(app.getPath("userData"), "window-state.json");
function loadState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), "utf8")); }
  catch { return { width: 1200, height: 820 }; }
}
function saveState(win) {
  if (!win || win.isDestroyed()) return;
  try { fs.writeFileSync(stateFile(), JSON.stringify(win.getBounds())); } catch {}
}

let mainWindow = null;
let tray = null;

// Windows taskbar grouping: declare the SAME AppUserModelID the NSIS installer
// bakes into the pinned shortcut (== electron-builder appId). Without this the
// running window gets a default AUMID that doesn't match the shortcut, so
// Windows shows a SECOND taskbar button instead of lighting up the pinned icon
// you launched from. No-op on macOS. Must run before any window is created.
app.setAppUserModelId("net.thinkopen.support");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
}

// True when the OS started us at login as a hidden item (boot straight to the
// tray and keep heartbeating presence without stealing focus). macOS reports
// this via wasOpenedAsHidden; on Windows we pass a --hidden arg in the login item.
function launchedHidden() {
  try {
    return process.argv.includes("--hidden") || app.getLoginItemSettings().wasOpenedAsHidden === true;
  } catch {
    return false;
  }
}

// First launch only: default to start-at-login (hidden to tray) so presence
// reporting is continuous without the user opting in. Forced ONCE (marker file)
// so a later opt-out via the tray sticks across updates.
function ensureAutostartDefault() {
  try {
    const marker = path.join(app.getPath("userData"), "autostart-initialized");
    if (fs.existsSync(marker)) return;
    app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true, args: ["--hidden"] });
    fs.writeFileSync(marker, new Date().toISOString());
  } catch {
    /* non-fatal */
  }
}

function showWindow() {
  if (!mainWindow) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function buildTray() {
  const img = nativeImage.createFromPath(
    path.join(__dirname, "..", "assets", "trayTemplate.png")
  );
  img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip("ThinkOpen Support");
  refreshTrayMenu();
  tray.on("click", () => showWindow());
}

function refreshTrayMenu() {
  if (!tray) return;
  const loginOn = app.getLoginItemSettings().openAtLogin;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open ThinkOpen Support", click: () => showWindow() },
      { type: "separator" },
      {
        label: "Open at Login",
        type: "checkbox",
        checked: loginOn,
        click: (item) => {
          app.setLoginItemSettings({
            openAtLogin: item.checked,
            openAsHidden: true,
            args: ["--hidden"],
          });
          refreshTrayMenu();
        },
      },
      { label: "Reload", click: () => mainWindow && mainWindow.webContents.reload() },
      { label: "Privacy & Activity…", click: () => showActivityDisclosure() },
      { type: "separator" },
      {
        label: "Quit ThinkOpen Support",
        accelerator: "Command+Q",
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ])
  );
}

function createWindow() {
  const s = loadState();
  const startHidden = launchedHidden();
  // The web app paints its own navy (#0A2540) title bar (DesktopTitleBar, h-10
  // = 40px) gated to window.minka.isDesktop. We hide the OS frame so that navy
  // bar IS the window title bar on every platform:
  //   macOS  → hiddenInset + traffic lights inset over the navy bar.
  //   Win/Linux → hidden + titleBarOverlay so the native min/max/close buttons
  //     paint navy with white glyphs INSIDE the 40px navy bar (height matches
  //     the web bar exactly). hiddenInset is a macOS-only no-op on Windows —
  //     using it there left the OS's own (cream) frame + menu bar showing with
  //     the web's navy bar stranded as a redundant strip below. This fixes that.
  const isMac = process.platform === "darwin";
  mainWindow = new BrowserWindow({
    width: s.width || 1200,
    height: s.height || 820,
    x: s.x,
    y: s.y,
    minWidth: 800,
    minHeight: 560,
    show: !startHidden, // start in the tray when auto-launched at login
    backgroundColor: "#0A2540", // ThinkOpen navy — matches the web app's navy bar, no flash
    title: "ThinkOpen Support",
    // Keep the native menu off the chrome on Win/Linux so it doesn't sit below
    // the navy bar and break the look; Alt still reveals it (copy/paste/reload).
    autoHideMenuBar: !isMac,
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    ...(isMac
      ? { trafficLightPosition: { x: 18, y: 13 } }
      : { titleBarOverlay: { color: "#0A2540", symbolColor: "#ffffff", height: 40 } }),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      // Keep the ~60s presence heartbeat at full fidelity while hidden in the
      // tray — Electron otherwise throttles a hidden window's timers.
      backgroundThrottling: false,
    },
  });

  mainWindow.loadURL(APP_URL);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternalHost(url)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!isInternalHost(url)) { e.preventDefault(); shell.openExternal(url); }
  });

  ["resize", "move"].forEach((evt) => mainWindow.on(evt, () => saveState(mainWindow)));

  // Close = hide to the tray (keeps the app + presence heartbeat alive). Real
  // quit goes through the tray's Quit or Cmd+Q (which set app.isQuitting first).
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    } else {
      saveState(mainWindow);
    }
  });
  mainWindow.on("closed", () => { mainWindow = null; });
}

function buildAppMenu() {
  // Minimal menu so copy/paste/select-all/reload work natively.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" }, { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ]));
}

app.whenReady().then(() => {
  buildAppMenu();
  ensureAutostartDefault();
  createWindow();
  buildTray();
  initAutoUpdates();
  app.on("activate", () => showWindow());
});

// The window hides to the tray on close, so the app stays resident (and keeps
// reporting presence). Only a real quit (tray Quit / Cmd+Q) exits.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  app.isQuitting = true;
  saveState(mainWindow);
});
