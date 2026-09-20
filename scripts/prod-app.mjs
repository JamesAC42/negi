#!/usr/bin/env node

import { execFile as execFileCallback, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktop = join(root, "apps", "desktop");
const backendPort = 47831;
const backendHost = "127.0.0.1";
const action = process.argv[2] ?? "build";

try {
  if (action === "build") await build();
  else if (action === "start") await start();
  else throw new Error(`Unknown command "${action}". Use build or start.`);
} catch (error) {
  console.error(`[prod] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

async function build() {
  assertWsl();
  const shell = await findProdShell();
  console.log(`[prod] WSL source: ${root}`);
  console.log(`[prod] Windows app: ${shell.root}`);
  await ensureWindowsElectron(shell);
  await buildArtifacts();
  await syncRuntime(shell);
  await writeRuntime(shell);
  await writeLaunchers(shell);
  console.log("[prod] Production app is ready to launch from Windows.");
  console.log(`[prod] Shortcut: ${shell.shortcut}`);
  console.log("[prod] Double-click that shortcut, or run Start negi.cmd in the same folder.");
  console.log("[prod] slskd is still started separately when you want Soulseek.");
}

async function start() {
  await build();
  const shell = await findProdShell();
  const electron = await toWindows(shell.electron);
  const app = await toWindows(shell.app);
  const working = await toWindows(shell.root);
  const script = [
    "Remove-Item Env:VITE_DEV_SERVER_URL -ErrorAction SilentlyContinue",
    `$p=Start-Process -FilePath ${quote(electron)} -ArgumentList @(${quote(app)}) -WorkingDirectory ${quote(working)} -PassThru`,
    "$p.Id"
  ].join(";");
  const { stdout } = await execFile("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8" });
  const pid = Number(stdout.trim().split(/\s+/).at(-1));
  if (!Number.isInteger(pid) || pid < 1) throw new Error(`Electron returned an invalid PID: ${stdout.trim()}`);
  console.log(`[prod] Native Windows process PID ${pid}. Close the window to stop the app.`);
}

async function buildArtifacts() {
  await run("npm", ["run", "build", "--workspace", "@music-os/desktop"]);
}

async function run(file, args) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(file, args, { cwd: root, env: process.env, stdio: "inherit" });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${file} ${args.join(" ")} failed (code=${code ?? "-"}, signal=${signal ?? "-"}).`));
    });
  });
}

async function findProdShell() {
  let shellRoot = process.env.MUSIC_OS_PROD_SHELL?.trim();
  if (shellRoot && /^[a-zA-Z]:[\\/]/.test(shellRoot)) shellRoot = await toWsl(shellRoot);
  if (!shellRoot) {
    const { stdout } = await execFile("powershell.exe", [
      "-NoProfile",
      "-Command",
      "[Environment]::GetFolderPath('LocalApplicationData')"
    ], { encoding: "utf8" });
    shellRoot = join(await toWsl(stdout.trim()), "negi");
  }
  return {
    root: resolve(shellRoot),
    app: join(shellRoot, "app"),
    electron: join(shellRoot, "node_modules", "electron", "dist", "electron.exe"),
    shortcut: join(shellRoot, "negi.lnk"),
    startCmd: join(shellRoot, "Start negi.cmd"),
    startVbs: join(shellRoot, "Start negi.vbs")
  };
}

async function ensureWindowsElectron(shell) {
  await mkdir(shell.root, { recursive: true });
  await mkdir(shell.app, { recursive: true });
  try {
    await access(shell.electron);
    return;
  } catch {}

  const localAppData = dirname(shell.root);
  const devElectron = join(localAppData, "negi-dev-shell", "node_modules", "electron", "dist", "electron.exe");
  try {
    await access(devElectron);
    console.log("[prod] Reusing the Windows Electron binary from negi-dev-shell.");
    await copyDirectory(join(localAppData, "negi-dev-shell", "node_modules", "electron"), join(shell.root, "node_modules", "electron"));
    await access(shell.electron);
    return;
  } catch {}

  console.log("[prod] Installing Windows Electron into the production shell.");
  const windowsRoot = await toWindows(shell.root);
  const script = [
    `Set-Location ${quote(windowsRoot)}`,
    "if (-not (Test-Path package.json)) { npm init -y | Out-Null }",
    "npm install --save-dev electron@^31.7.0"
  ].join("; ");
  await execFile("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8" });
  await access(shell.electron);
}

async function syncRuntime(shell) {
  await mkdir(join(shell.app, "dist"), { recursive: true });
  await copyDirectory(join(desktop, "dist", "main"), join(shell.app, "dist", "main"));
  await copyDirectory(join(desktop, "dist", "preload"), join(shell.app, "dist", "preload"));
  await copyDirectory(join(desktop, "dist", "renderer"), join(shell.app, "dist", "renderer"));
  await copyFile(join(desktop, "package.json"), join(shell.app, "package.json"));
  await copyFile(join(desktop, "public", "negi.png"), join(shell.app, "dist", "renderer", "negi.png"));
  console.log("[prod] Copied production renderer, main, and preload into the Windows app folder.");
}

async function writeRuntime(shell) {
  const runtime = {
    version: 1,
    distro: process.env.WSL_DISTRO_NAME || "Ubuntu",
    repositoryRoot: root,
    backendHost,
    backendPort,
    backendPidFile: join(root, ".music-os", "prod-backend.pid")
  };
  await writeFile(join(shell.app, "runtime.json"), `${JSON.stringify(runtime, null, 2)}\n`, "utf8");
}

async function writeLaunchers(shell) {
  const electron = await toWindows(shell.electron);
  const app = await toWindows(shell.app);
  const working = await toWindows(shell.root);
  const cmd = [
    "@echo off",
    "setlocal",
    "set VITE_DEV_SERVER_URL=",
    `start \"negi\" ${windowsQuote(electron)} ${windowsQuote(app)}`,
    ""
  ].join("\r\n");
  await writeFile(shell.startCmd, cmd, "utf8");

  const vbs = [
    "Set sh = CreateObject(\"WScript.Shell\")",
    `sh.CurrentDirectory = ${vbsQuote(working)}`,
    "sh.Environment(\"Process\").Remove(\"VITE_DEV_SERVER_URL\")",
    `sh.Run ${vbsQuote(`${windowsQuote(electron)} ${windowsQuote(app)}`)}, 1, False`,
    ""
  ].join("\r\n");
  await writeFile(shell.startVbs, vbs, "utf8");

  const icon = await toWindows(join(shell.app, "dist", "renderer", "negi.png"));
  const script = [
    `$ws = New-Object -ComObject WScript.Shell`,
    `$lnk = $ws.CreateShortcut(${quote(await toWindows(shell.shortcut))})`,
    `$lnk.TargetPath = ${quote(electron)}`,
    `$lnk.Arguments = ${quote(windowsQuote(app))}`,
    `$lnk.WorkingDirectory = ${quote(working)}`,
    `$lnk.WindowStyle = 1`,
    `$lnk.Description = 'negi'`,
    `$lnk.IconLocation = ${quote(`${icon},0`)}`,
    `$lnk.Save()`
  ].join("; ");
  try {
    await execFile("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8" });
  } catch (error) {
    console.warn(`[prod] Shortcut creation skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function copyDirectory(source, destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) await copyDirectory(from, to);
    else if (entry.isFile()) {
      if ((await hash(from)) !== (await hash(to))) await copyFile(from, to);
    }
  }
}

async function hash(path) {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch {
    return null;
  }
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function windowsQuote(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function vbsQuote(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function toWsl(path) {
  return (await execFile("wslpath", ["-u", path], { encoding: "utf8" })).stdout.trim();
}

async function toWindows(path) {
  return (await execFile("wslpath", ["-w", path], { encoding: "utf8" })).stdout.trim();
}

function assertWsl() {
  if (process.platform !== "linux" || !process.env.WSL_DISTRO_NAME) {
    throw new Error("Run this command inside the authoritative Ubuntu WSL checkout.");
  }
}
