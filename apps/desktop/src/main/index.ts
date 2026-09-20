import { app, BrowserWindow, dialog, ipcMain, net, protocol } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appName = "negi";
const appIconPath = join(__dirname, "../renderer/negi.png");
const backgroundImageScheme = "music-os-image";
const backgroundImageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);

type RuntimeConfig = {
  version: number;
  distro: string;
  repositoryRoot: string;
  backendHost: string;
  backendPort: number;
  backendPidFile: string;
};

let ownedBackend: ChildProcess | null = null;
let ownedBackendPidFile: string | null = null;
let ownedBackendDistro: string | null = null;

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
      spellcheck: false,
      backgroundThrottling: true,
      preload: join(__dirname, "../preload/index.cjs")
    }
  });
  window.webContents.session.setSpellCheckerEnabled(false);

  if (process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  registerBackgroundImageProtocol();
  try {
    await ensureBackend();
  } catch (error) {
    dialog.showErrorBox(appName, error instanceof Error ? error.message : String(error));
    app.quit();
    return;
  }
  await createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void stopOwnedBackend();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

async function ensureBackend(): Promise<void> {
  if (process.env.VITE_DEV_SERVER_URL) {
    return;
  }

  const runtime = loadRuntime();
  const host = process.env.MUSIC_OS_HOST ?? runtime?.backendHost ?? "127.0.0.1";
  const port = Number(process.env.MUSIC_OS_PORT ?? runtime?.backendPort ?? 47831);
  if (await backendReady(host, port)) {
    return;
  }
  if (!runtime) {
    throw new Error("Production runtime.json is missing. From the WSL checkout, run npm run build:app.");
  }

  await startWslBackend(runtime);
  const started = Date.now();
  while (Date.now() - started < 45_000) {
    if (await backendReady(runtime.backendHost, runtime.backendPort)) {
      return;
    }
    await delay(250);
  }
  throw new Error("Timed out waiting for the music backend to start inside WSL.");
}

function loadRuntime(): RuntimeConfig | null {
  const path = join(__dirname, "../../runtime.json");
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as RuntimeConfig;
    if (!parsed?.distro || !parsed.repositoryRoot || !parsed.backendPidFile) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function backendReady(host: string, port: number): Promise<boolean> {
  try {
    const response = await net.fetch(`http://${host}:${port}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

function startWslBackend(runtime: RuntimeConfig): Promise<void> {
  const command = [
    "source ~/.nvm/nvm.sh",
    `cd ${bashQuote(runtime.repositoryRoot)}`,
    "mkdir -p .music-os",
    `echo $$ > ${bashQuote(runtime.backendPidFile)}`,
    "exec npx tsx apps/backend/src/server.ts"
  ].join(" && ");
  const child = spawn("wsl.exe", ["-d", runtime.distro, "--", "bash", "-lc", command], {
    stdio: "ignore",
    windowsHide: true
  });
  ownedBackend = child;
  ownedBackendPidFile = runtime.backendPidFile;
  ownedBackendDistro = runtime.distro;
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("spawn", () => resolvePromise());
  });
}

async function stopOwnedBackend(): Promise<void> {
  if (!ownedBackend && !ownedBackendPidFile) {
    return;
  }
  if (ownedBackendDistro && ownedBackendPidFile) {
    spawn("wsl.exe", [
      "-d",
      ownedBackendDistro,
      "--",
      "bash",
      "-lc",
      `pid=$(cat ${bashQuote(ownedBackendPidFile)} 2>/dev/null); rm -f ${bashQuote(ownedBackendPidFile)}; if [ -n "$pid" ]; then kill -TERM -$pid "$pid" 2>/dev/null; fi`
    ], { stdio: "ignore", windowsHide: true, detached: true }).unref();
  }
  ownedBackend?.kill();
  ownedBackend = null;
  ownedBackendPidFile = null;
  ownedBackendDistro = null;
}

function bashQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

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
