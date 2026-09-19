// Preload — exposes the same tiny desktop bridge the Staff (Minka) app uses, so
// the web app's navy title bar (login, client portal, org-admin admin shell)
// renders inside this window too. The bar/drag-region/traffic-light clearance
// are owned by the web app, gated to window.minka.isDesktop — so this only sets
// the flag (no DOM/CSS injection).
//
// focusWindow brings the window forward (1.2.0: remote-support notification
// click); setBadge is still a stub. The bridge shape stays identical to Staff so
// the web code is portable.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("minka", {
  isDesktop: true,
  app: "support",
  version: "",
  platform: process.platform,
  focusWindow: () => ipcRenderer.send("minka:focus-window"),
  setBadge: () => {},
  // Auto-update bridge: the web app shows a branded "Update ready" modal when
  // the shell finishes downloading a new version, and installUpdate() triggers
  // quitAndInstall() (close → install → relaunch). Mirrors the Staff app.
  onUpdateReady: (cb) =>
    ipcRenderer.on("minka:update-ready", (_e, info) => cb(info)),
  installUpdate: () => ipcRenderer.invoke("minka:install-update"),
  // Koban inventory agent — returns a one-shot device snapshot (or null). The
  // web app gates on entitlement and owns the authenticated POST.
  getInventory: () => ipcRenderer.invoke("minka:get-inventory"),
  // Koban presence agent — returns a live session snapshot (or null). The web
  // app gates on the `activity` entitlement + disclosure and owns the POST.
  getPresence: () => ipcRenderer.invoke("minka:get-presence"),
  // "Start remote support" (1.2.0): fetch, signature-check and launch the
  // ThinkOpen Support client; resolves { ok, hostname, error? }.
  startRemoteSupport: () => ipcRenderer.invoke("minka:start-remote-support"),
});
