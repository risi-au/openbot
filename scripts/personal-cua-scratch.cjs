const { app, BrowserWindow, ipcMain } = require("electron");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

const output = resolve(process.cwd(), ".openbot-build/cua-scratch");
mkdirSync(output, { recursive: true });
app.setPath("userData", join(output, "profile"));
const preload = join(output, "preload.cjs");
writeFileSync(
  preload,
  'const { contextBridge, ipcRenderer } = require("electron"); contextBridge.exposeInMainWorld("scratch", { report: (value) => ipcRenderer.send("scratch", value) });',
);
app.whenReady().then(() => {
  const window = new BrowserWindow({
    title: "OpenBot CUA scratch",
    width: 600,
    height: 350,
    show: false,
    webPreferences: { preload, contextIsolation: true, sandbox: true },
  });
  window.once("ready-to-show", () => window.showInactive());
  ipcMain.on("scratch", (event, value) => {
    if (event.sender !== window.webContents || typeof value !== "string") return;
    writeFileSync(join(output, "state.json"), JSON.stringify({ value }));
  });
  window.loadURL(
    `data:text/html,${encodeURIComponent('<title>OpenBot CUA scratch</title><h1>OpenBot CUA scratch</h1><label>Scratch text<textarea aria-label="Scratch text" rows="6" cols="55" oninput="window.scratch.report(this.value)"></textarea></label><p>Temporary input test. No existing document or login is used.</p>')}`,
  );
});
app.on("window-all-closed", () => app.quit());
