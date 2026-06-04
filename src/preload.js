// Preload — exposes the same tiny desktop bridge the Staff (Minka) app uses, so
// the web app's navy title bar (login, client portal, org-admin admin shell)
// renders inside this window too. The bar/drag-region/traffic-light clearance
// are owned by the web app, gated to window.minka.isDesktop — so this only sets
// the flag (no DOM/CSS injection).
//
// focusWindow/setBadge are stubs here (no tray/Realtime in the Support app yet);
// they keep the bridge shape identical to Staff so the web code is portable and
// future client-portal notifications can wire the IPC without a contract change.

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("minka", {
  isDesktop: true,
  app: "support",
  version: "",
  focusWindow: () => {},
  setBadge: () => {},
});
