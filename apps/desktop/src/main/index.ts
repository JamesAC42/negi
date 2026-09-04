import { app, BrowserWindow, dialog, ipcMain, net, protocol } from "electron";
import { dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appName = "negi";
const appIconPath = join(__dirname, "../renderer/negi.png");
const backgroundImageScheme = "music-os-image";
const backgroundImageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);

protocol.registerSchemesAsPrivileged([
  {
    scheme: backgroundImageScheme,
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true
    }
  }
]);

app.setName(appName);
app.setAppUserModelId("com.jamesac42.negi");

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
    url: toBackgroundImageUrl(path)
  };
});

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: appName,
    icon: appIconPath,
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

app.whenReady().then(async () => {
  registerBackgroundImageProtocol();
  await createWindow();
});

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

function toWindowsPath(path: string): string | null {
  const normalized = path.replaceAll("\\", "/");
  const wslDrivePath = normalized.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (!wslDrivePath || !wslDrivePath[2] || wslDrivePath[2].includes("\0")) {
    return null;
  }
  return `${wslDrivePath[1].toUpperCase()}:\\${wslDrivePath[2].replaceAll("/", "\\")}`;
}

function toBackgroundImageUrl(path: string): string {
  return `${backgroundImageScheme}://local/?path=${encodeURIComponent(toWslPath(path))}`;
}

function registerBackgroundImageProtocol(): void {
  protocol.handle(backgroundImageScheme, (request) => {
    try {
      const requestUrl = new URL(request.url);
      const requestedPath = requestUrl.searchParams.get("path");
      if (requestUrl.hostname !== "local" || !requestedPath) {
        return new Response(null, { status: 404 });
      }

      const localPath = toWindowsPath(requestedPath);
      if (!localPath || !backgroundImageExtensions.has(extname(localPath).toLowerCase())) {
        return new Response(null, { status: 415 });
      }

      return net.fetch(pathToFileURL(localPath).href);
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
