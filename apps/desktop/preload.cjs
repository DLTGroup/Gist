// Exposes a minimal, explicit bridge to the web app (see apps/web/src/api.ts: window.gistDesktop).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gistDesktop", {
  apiBase: "", // the web app is served by the API, so requests stay same-origin
  onGistUrl: (cb) => ipcRenderer.on("gist-url", (_e, url) => cb(url)),
  openExternal: (url) => ipcRenderer.send("open-external", url),
});
