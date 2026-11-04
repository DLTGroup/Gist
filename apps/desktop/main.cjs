// Gist desktop: wraps the Gist web app and adds OS-level capture.
//  - Global shortcut (Ctrl/Cmd+Shift+G) gists whatever link is on the clipboard.
//  - gist://new?url=… deep links (for a browser bookmarklet or other apps).
//  - Tray icon to open Gist or gist the clipboard.
const { app, BrowserWindow, Tray, Menu, globalShortcut, clipboard, shell, nativeImage, ipcMain } = require("electron");
const path = require("node:path");

// The deployed web app (which also serves the API). Override for local development.
const APP_URL = process.env.GIST_APP_URL || "http://localhost:8787";
const SHORTCUT = "CommandOrControl+Shift+G";

let win = null;
let tray = null;
let pendingUrl = null;

if (!app.requestSingleInstanceLock()) app.quit();
if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient("gist", process.execPath, [path.resolve(process.argv[1])]);
else app.setAsDefaultProtocolClient("gist");

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 380,
    title: "Gist",
    backgroundColor: "#f7f7f5",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  win.loadURL(`${APP_URL}/app/new`);
  // Open external links (sources, Notion pages, obsidian://) in the system handler, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(APP_URL)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  win.webContents.on("did-finish-load", () => {
    if (pendingUrl) {
      win.webContents.send("gist-url", pendingUrl);
      pendingUrl = null;
    }
  });
  win.on("closed", () => (win = null));
}

function gistUrl(url) {
  if (!/^https?:\/\//i.test(url || "")) return false;
  if (!win) createWindow();
  win.show();
  win.focus();
  if (win.webContents.isLoading()) pendingUrl = url;
  else win.webContents.send("gist-url", url);
  return true;
}

function gistClipboard() {
  const text = clipboard.readText().trim();
  const url = text.match(/https?:\/\/\S+/)?.[0];
  if (!gistUrl(url)) {
    if (!win) createWindow();
    win.show();
  }
}

function handleDeepLink(link) {
  try {
    const u = new URL(link);
    if (u.protocol === "gist:") gistUrl(u.searchParams.get("url"));
  } catch {
    /* ignore malformed links */
  }
}

app.on("second-instance", (_e, argv) => {
  const link = argv.find((a) => a.startsWith("gist://"));
  if (link) handleDeepLink(link);
  else if (win) win.show();
});
app.on("open-url", (e, link) => {
  e.preventDefault();
  app.isReady() ? handleDeepLink(link) : (pendingUrl = new URL(link).searchParams.get("url"));
});

ipcMain.on("open-external", (_e, url) => {
  if (/^(https?|obsidian|notion):/i.test(url)) shell.openExternal(url);
});

app.whenReady().then(() => {
  createWindow();
  globalShortcut.register(SHORTCUT, gistClipboard);
  const icon = nativeImage.createFromPath(path.join(__dirname, "build", "icon.png")).resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip("Gist");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Gist", click: () => (win ? win.show() : createWindow()) },
      { label: `Gist the link on my clipboard (${process.platform === "darwin" ? "⌘⇧G" : "Ctrl+Shift+G"})`, click: gistClipboard },
      { type: "separator" },
      { label: "Quit", role: "quit" },
    ]),
  );
  const link = process.argv.find((a) => a.startsWith("gist://"));
  if (link) handleDeepLink(link);
});

app.on("activate", () => (win ? win.show() : createWindow()));
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
