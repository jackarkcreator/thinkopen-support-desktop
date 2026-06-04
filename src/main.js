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

const { app, BrowserWindow, Menu, shell, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { autoUpdater } = require("electron-updater");

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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
}

function createWindow() {
  const s = loadState();
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
  createWindow();
  initAutoUpdates();
  app.on("activate", () => { if (!mainWindow) createWindow(); else mainWindow.focus(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => saveState(mainWindow));
