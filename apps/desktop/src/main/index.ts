import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

ipcMain.handle("dialog:select-library-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return toWslPath(result.filePaths[0]);
});

ipcMain.handle("dialog:select-import-files", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"]
  });
  if (result.canceled) {
    return [];
  }
  return result.filePaths.map(toWslPath);
});

ipcMain.handle("dialog:select-import-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"]
  });
  if (result.canceled) {
    return [];
  }
  return result.filePaths.map(toWslPath);
});

ipcMain.handle("dialog:select-background-image", async () => {
  const result = await dialog.showOpenDialog({
    filters: [
      {
        name: "Images",
        extensions: ["jpg", "jpeg", "png", "webp", "gif", "avif"]
      }
    ],
    properties: ["openFile"]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  const path = result.filePaths[0];
  return {
    path: toWslPath(path),
    url: pathToFileURL(path).href
  };
});

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "Music OS",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: join(__dirname, "../preload/index.cjs")
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

function toWslPath(path: string): string {
  const windowsDrive = path.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (!windowsDrive) {
    return path.replaceAll("\\", "/");
  }

  const drive = windowsDrive[1].toLowerCase();
  const rest = windowsDrive[2].replaceAll("\\", "/");
  return `/mnt/${drive}/${rest}`;
}
