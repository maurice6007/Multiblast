const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

const isDev = !app.isPackaged;

function firstExisting(paths) {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Always open DevTools while debugging packaged builds
  win.webContents.openDevTools({ mode: "detach" });

  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error("did-fail-load", { code, desc, url });
  });

  win.webContents.on("render-process-gone", (_e, details) => {
    console.error("render-process-gone", details);
  });

  if (isDev) {
    console.log("[DEV] loading http://localhost:5173");
    win.loadURL("http://localhost:5173");
    return;
  }

  // Try a few common production locations
  const candidates = [
    path.join(app.getAppPath(), "dist", "index.html"),                // app.asar/dist/index.html
    path.join(process.resourcesPath, "app.asar", "dist", "index.html"),
    path.join(process.resourcesPath, "dist", "index.html"),
    path.join(process.resourcesPath, "app", "dist", "index.html"),    // if asar disabled
  ];

  const indexPath = firstExisting(candidates);

  console.log("[PROD] app.getAppPath() =", app.getAppPath());
  console.log("[PROD] process.resourcesPath =", process.resourcesPath);
  console.log("[PROD] index candidates =", candidates);
  console.log("[PROD] chosen indexPath =", indexPath);

  if (!indexPath) {
    win.loadURL(
      "data:text/plain;charset=utf-8," +
        encodeURIComponent(
          "ERROR: dist/index.html not found.\n\nTried:\n" + candidates.join("\n")
        )
    );
    return;
  }

  // Use file:// URL explicitly (more reliable than loadFile with asar edge cases)
  win.loadURL(pathToFileURL(indexPath).toString());
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
