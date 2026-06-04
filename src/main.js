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

const { app, BrowserWindow, Menu, shell, nativeImage } = require("electron");
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
  // Initial check shortly after launch, then every 6 hours while resident.
  const check = () => autoUpdater.checkForUpdatesAndNotify().catch(() => {});
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
  mainWindow = new BrowserWindow({
    width: s.width || 1200,
    height: s.height || 820,
    x: s.x,
    y: s.y,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: "#0A2540", // ThinkOpen navy — matches the web app's navy bar, no flash
    title: "ThinkOpen Support",
    // Frameless: the web app paints its own navy title bar and the OS traffic
    // lights sit inset on it (centered in the 40px bar) — identical to Staff.
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 13 },
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
