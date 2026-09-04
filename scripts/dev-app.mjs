#!/usr/bin/env node

import { execFile as execFileCallback, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { watch } from "node:fs";
import { access, copyFile, mkdir, readFile, readdir, readlink, rename, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import readline from "node:readline";

const execFile = promisify(execFileCallback);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktop = join(root, "apps", "desktop");
const stateDir = join(root, ".music-os");
const stateFile = join(stateDir, "dev-app.json");
const rendererPort = 5173;
const backendPort = 47831;
const rendererUrl = `http://127.0.0.1:${rendererPort}`;
const backendUrl = `http://127.0.0.1:${backendPort}/health`;
const action = process.argv[2] ?? "start";

let context = null;
let stopping = false;
let rebuilding = false;
let rebuildAgain = false;
const expectedExits = new Set();

try {
  if (action === "start") await start();
  else if (action === "stop") await stop();
  else if (action === "doctor") await doctor();
  else if (action === "sync") await syncOnly();
  else throw new Error(`Unknown command "${action}". Use start, stop, doctor, or sync.`);
} catch (error) {
  console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

async function start() {
  assertWsl();
  await mkdir(stateDir, { recursive: true });
  const oldState = await readState();
  if (oldState && alive(oldState.orchestratorPid)) {
    throw new Error(`Managed development is already running as PID ${oldState.orchestratorPid}. Run npm run dev:doctor.`);
  }
  if (oldState) await rm(stateFile, { force: true });
  const unmanagedBackendWatchers = await backendWatcherPids();
  if (unmanagedBackendWatchers.length > 0) {
    throw new Error(
      `Unmanaged backend watch process${unmanagedBackendWatchers.length === 1 ? "" : "es"} still running ` +
      `(PID${unmanagedBackendWatchers.length === 1 ? "" : "s"} ${unmanagedBackendWatchers.join(", ")}). ` +
      "Stop the stale watcher once, then rerun npm run dev:app. Use npm run dev:doctor for details."
    );
  }
  await requireFreePort(rendererPort, "renderer");
  await requireFreePort(backendPort, "backend");

  const shell = await findShell();
  await verifyShell(shell);
  const unmanagedElectronPids = await shellElectronPids(shell);
  if (unmanagedElectronPids.length > 0) {
    throw new Error(
      `The Windows negi Electron shell is already running (PIDs ${unmanagedElectronPids.join(", ")}). ` +
      "Close that old window once, then rerun npm run dev:app."
    );
  }
  console.log(`[dev] WSL source: ${root}`);
  console.log(`[dev] Windows Electron: ${shell.root}`);
  await buildElectron();
  await syncRuntime(shell);

  context = {
    shell,
    backend: null,
    renderer: null,
    electronPid: null,
    watchers: [],
    rebuildTimer: null,
    state: {
      version: 1,
      orchestratorPid: process.pid,
      backendPid: null,
      rendererPid: null,
      electronPid: null,
      repositoryRoot: root,
      electronShell: shell.root,
      rendererUrl,
      backendUrl,
      startedAt: new Date().toISOString()
    }
  };

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.once(signal, () => void shutdown(0));
  }

  context.backend = spawnManaged("backend", ["run", "dev:watch", "--workspace", "@music-os/backend"]);
  context.renderer = spawnManaged("renderer", ["run", "dev", "--workspace", "@music-os/desktop"]);
  context.state.backendPid = context.backend.pid;
  context.state.rendererPid = context.renderer.pid;
  await saveState();

  try {
    await Promise.all([waitForUrl(backendUrl, "backend"), waitForUrl(rendererUrl, "renderer")]);
    context.electronPid = await launchElectron(shell);
    context.state.electronPid = context.electronPid;
    await saveState();
    installElectronWatchers();
  } catch (error) {
    await shutdown(1);
    throw error;
  }

  console.log("[dev] Ready: renderer HMR, watched backend, and native Windows Electron.");
  console.log("[dev] Main/preload changes rebuild, sync, and restart only Electron.");
  console.log("[dev] Press Ctrl+C once to stop the entire managed stack.");
  await new Promise(() => {});
}

function spawnManaged(label, args) {
  const child = spawn("npm", args, {
    cwd: root,
    detached: true,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  prefix(child.stdout, label, console.log);
  prefix(child.stderr, label, console.error);
  child.once("exit", (code, signal) => {
    if (stopping || expectedExits.delete(child.pid)) return;
    console.error(`[dev] ${label} exited unexpectedly (code=${code ?? "-"}, signal=${signal ?? "-"}).`);
    void shutdown(1);
  });
  return child;
}

function prefix(stream, label, output) {
  if (!stream) return;
  readline.createInterface({ input: stream }).on("line", (line) => output(`[${label}] ${line}`));
}

function installElectronWatchers() {
  const changed = () => {
    clearTimeout(context.rebuildTimer);
    context.rebuildTimer = setTimeout(() => void rebuildElectron(), 250);
  };
  for (const [target, recursive] of [
    [join(desktop, "src", "main"), true],
    [join(desktop, "src", "preload"), true],
    [join(desktop, "vite.main.config.ts"), false]
  ]) {
    const watcher = watch(target, { recursive }, changed);
    watcher.on("error", (error) => console.error(`[watch] ${target}: ${error.message}`));
    context.watchers.push(watcher);
  }
}

async function rebuildElectron() {
  if (rebuilding) {
    rebuildAgain = true;
    return;
  }
  rebuilding = true;
  try {
    console.log("[electron] Rebuilding main/preload from WSL.");
    await buildElectron();
    await syncRuntime(context.shell);
    await stopElectron(context.electronPid);
    context.electronPid = await launchElectron(context.shell);
    context.state.electronPid = context.electronPid;
    await saveState();
    console.log("[electron] Restarted with the current bundle.");
  } catch (error) {
    console.error(`[electron] Rebuild failed; previous window kept when possible: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rebuilding = false;
    if (rebuildAgain) {
      rebuildAgain = false;
      context.rebuildTimer = setTimeout(() => void rebuildElectron(), 100);
    }
  }
}

async function buildElectron() {
  await run("npm", ["run", "build:electron", "--workspace", "@music-os/desktop"]);
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

async function syncOnly() {
  assertWsl();
  const shell = await findShell();
  await verifyShell(shell);
  await buildElectron();
  await syncRuntime(shell);
  console.log("[dev] Windows runtime synchronized. Restart Electron to load it.");
}

async function findShell() {
  let shellRoot = process.env.MUSIC_OS_ELECTRON_SHELL?.trim();
  if (shellRoot && /^[a-zA-Z]:[\\/]/.test(shellRoot)) shellRoot = await toWsl(shellRoot);
  if (!shellRoot) {
    const { stdout } = await execFile("powershell.exe", [
      "-NoProfile",
      "-Command",
      "[Environment]::GetFolderPath('LocalApplicationData')"
    ], { encoding: "utf8" });
    shellRoot = join(await toWsl(stdout.trim()), "negi-dev-shell");
  }
  return {
    root: resolve(shellRoot),
    app: join(shellRoot, "app"),
    electron: join(shellRoot, "node_modules", "electron", "dist", "electron.exe"),
    logs: join(shellRoot, ".music-os")
  };
}

async function verifyShell(shell) {
  for (const path of [shell.electron, join(shell.app, "package.json")]) {
    try {
      await access(path);
    } catch {
      throw new Error(`Windows Electron shell is missing ${path}. Set MUSIC_OS_ELECTRON_SHELL if needed.`);
    }
  }
}

async function shellElectronPids(shell) {
  const executable = await toWindows(shell.electron);
  const script =
    `$target=${quote(executable)}; Get-CimInstance Win32_Process -Filter "Name='electron.exe'" ` +
    "| Where-Object { $_.ExecutablePath -eq $target } | ForEach-Object { $_.ProcessId }";
  try {
    const { stdout } = await execFile("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8" });
    return stdout.split(/\s+/).map(Number).filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

async function syncRuntime(shell) {
  const files = [
    [join(desktop, "dist", "main", "index.js"), join(shell.app, "dist", "main", "index.js")],
    [join(desktop, "dist", "preload", "index.cjs"), join(shell.app, "dist", "preload", "index.cjs")],
    [join(desktop, "package.json"), join(shell.app, "package.json")],
    [join(desktop, "public", "negi.png"), join(shell.app, "dist", "renderer", "negi.png")]
  ];
  for (const [source, destination] of files) {
    await access(source);
    await mkdir(dirname(destination), { recursive: true });
    if ((await hash(source)) !== (await hash(destination))) {
      await copyFile(source, destination);
      console.log(`[sync] ${source.slice(root.length + 1)} -> Windows Electron shell`);
    }
  }
}

async function launchElectron(shell) {
  await mkdir(shell.logs, { recursive: true });
  const electron = await toWindows(shell.electron);
  const app = await toWindows(shell.app);
  const working = await toWindows(shell.root);
  const stdoutLog = await toWindows(join(shell.logs, "electron.stdout.log"));
  const stderrLog = await toWindows(join(shell.logs, "electron.stderr.log"));
  const script = [
    `$env:VITE_DEV_SERVER_URL=${quote(rendererUrl)}`,
    `$env:MUSIC_OS_HOST='127.0.0.1'`,
    `$env:MUSIC_OS_PORT='${backendPort}'`,
    `$p=Start-Process -FilePath ${quote(electron)} -ArgumentList @(${quote(app)}) -WorkingDirectory ${quote(working)} -RedirectStandardOutput ${quote(stdoutLog)} -RedirectStandardError ${quote(stderrLog)} -PassThru`,
    "$p.Id"
  ].join(";");
  const { stdout } = await execFile("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8" });
  const pid = Number(stdout.trim().split(/\s+/).at(-1));
  if (!Number.isInteger(pid) || pid < 1) throw new Error(`Electron returned an invalid PID: ${stdout.trim()}`);
  console.log(`[electron] Native Windows process PID ${pid}.`);
  return pid;
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  console.log("[dev] Stopping managed processes.");
  if (context) {
    clearTimeout(context.rebuildTimer);
    for (const watcher of context.watchers) watcher.close();
    await stopElectron(context.electronPid);
    await Promise.all([stopGroup(context.renderer?.pid), stopGroup(context.backend?.pid)]);
  }
  await rm(stateFile, { force: true });
  console.log("[dev] Managed stack stopped.");
  process.exit(code);
}

async function stop() {
  const state = await readState();
  if (!state) {
    console.log("[dev] No managed stack exists. Manual processes were not touched.");
    return;
  }
  if (alive(state.orchestratorPid) && state.orchestratorPid !== process.pid) {
    process.kill(state.orchestratorPid, "SIGTERM");
    if (await waitUntil(() => !alive(state.orchestratorPid), 10_000)) {
      console.log("[dev] Managed stack stopped.");
      return;
    }
  }
  await stopElectron(state.electronPid);
  await Promise.all([stopGroup(state.rendererPid), stopGroup(state.backendPid)]);
  await rm(stateFile, { force: true });
  console.log("[dev] Stale managed state cleaned up.");
}

async function stopGroup(pid) {
  if (!pid) return;
  expectedExits.add(pid);
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    return;
  }
  if (!(await waitUntil(() => !alive(pid), 3_000))) {
    try { process.kill(-pid, "SIGKILL"); } catch {}
  }
}

async function stopElectron(pid) {
  if (!pid || !(await windowsAlive(pid))) return;
  try {
    await execFile("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8" });
  } catch {}
}

async function doctor() {
  assertWsl();
  const state = await readState();
  console.log(`Authoritative checkout: ${root}`);
  console.log(`Managed stack: ${state ? "state present" : "stopped / unmanaged"}`);
  if (state) {
    await showLinux("orchestrator", state.orchestratorPid);
    await showLinux("backend", state.backendPid);
    await showLinux("renderer", state.rendererPid);
    console.log(`Windows Electron: PID ${state.electronPid ?? "-"} (${await windowsAlive(state.electronPid) ? "running" : "not running"})`);
  }
  console.log(`Renderer ${rendererUrl}: ${await status(rendererUrl)}`);
  console.log(`Backend ${backendUrl}: ${await status(backendUrl)}`);
  try {
    const shell = await findShell();
    await verifyShell(shell);
    const current = (await hash(join(desktop, "dist", "main", "index.js"))) ===
      (await hash(join(shell.app, "dist", "main", "index.js")));
    console.log(`Windows Electron shell: ${shell.root}`);
    console.log(`Electron main bundle: ${current ? "synchronized" : "STALE"}`);
    const shellPids = await shellElectronPids(shell);
    console.log(`Electron shell processes: ${shellPids.length ? shellPids.join(", ") : "none"}`);
    console.log(`Electron logs: ${shell.logs}`);
  } catch (error) {
    console.log(`Windows Electron shell: ${error instanceof Error ? error.message : String(error)}`);
  }
  const watcherPids = await backendWatcherPids();
  const managedWatcherPids = [];
  const unmanagedWatcherPids = [];
  for (const pid of watcherPids) {
    if (state?.backendPid && await isDescendantOf(pid, state.backendPid)) {
      managedWatcherPids.push(pid);
    } else {
      unmanagedWatcherPids.push(pid);
    }
  }
  console.log(`Managed backend watchers: ${managedWatcherPids.length ? managedWatcherPids.join(", ") : "none"}`);
  console.log(`Unmanaged backend watchers: ${unmanagedWatcherPids.length ? unmanagedWatcherPids.join(", ") : "none"}`);
  try {
    const { stdout } = await execFile("ss", ["-ltnp"], { encoding: "utf8" });
    const rows = stdout.split(/\r?\n/).filter((line) => line.includes(`:${rendererPort} `) || line.includes(`:${backendPort} `));
    console.log(rows.length ? `Port listeners:\n${rows.map((row) => `  ${row.trim()}`).join("\n")}` : "Port listeners: none");
  } catch {
    console.log("Port listeners: unavailable");
  }
}

async function backendWatcherPids() {
  const backendRoot = join(root, "apps", "backend");
  const matches = [];
  let entries = [];
  try {
    entries = await readdir("/proc", { withFileTypes: true });
  } catch {
    return matches;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const pid = Number(entry.name);
    try {
      const [cwd, commandLine] = await Promise.all([
        readlink(`/proc/${pid}/cwd`),
        readFile(`/proc/${pid}/cmdline`, "utf8")
      ]);
      const args = commandLine.split("\0").filter(Boolean);
      const watchIndex = args.indexOf("watch");
      const isTsx = args.some((argument) => /(?:^|\/)tsx$/.test(argument));
      if (cwd === backendRoot && isTsx && watchIndex >= 0 && args[watchIndex + 1] === "src/server.ts") {
        matches.push(pid);
      }
    } catch {
      // Processes can exit while /proc is being inspected.
    }
  }
  return matches.sort((left, right) => left - right);
}

async function isDescendantOf(pid, ancestorPid) {
  let currentPid = pid;
  for (let depth = 0; depth < 64 && currentPid > 1; depth += 1) {
    if (currentPid === ancestorPid) return true;
    try {
      const statusText = await readFile(`/proc/${currentPid}/status`, "utf8");
      const parentMatch = statusText.match(/^PPid:\s+(\d+)$/m);
      if (!parentMatch) return false;
      currentPid = Number(parentMatch[1]);
    } catch {
      return false;
    }
  }
  return false;
}

async function showLinux(label, pid) {
  if (!pid || !alive(pid)) {
    console.log(`${label}: PID ${pid ?? "-"} (not running)`);
    return;
  }
  const cmd = (await readFile(`/proc/${pid}/cmdline`, "utf8")).replaceAll("\0", " ").trim();
  console.log(`${label}: PID ${pid} cwd=${await readlink(`/proc/${pid}/cwd`)} cmd=${cmd}`);
}

async function windowsAlive(pid) {
  if (!pid) return false;
  try {
    await execFile("powershell.exe", ["-NoProfile", "-Command",
      `if(Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue){exit 0}else{exit 1}`]);
    return true;
  } catch {
    return false;
  }
}

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function requireFreePort(port, label) {
  if (await portOpen(port)) {
    throw new Error(`Port ${port} is occupied by an unmanaged ${label}. Stop it, then rerun. Use npm run dev:doctor for details.`);
  }
}

function portOpen(port) {
  return new Promise((resolvePromise) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(350);
    socket.once("connect", () => { socket.destroy(); resolvePromise(true); });
    const closed = () => { socket.destroy(); resolvePromise(false); };
    socket.once("error", closed);
    socket.once("timeout", closed);
  });
}

async function waitForUrl(url, label) {
  const startTime = Date.now();
  while (Date.now() - startTime < 45_000) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        console.log(`[${label}] Ready at ${url}`);
        return;
      }
    } catch {}
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label} at ${url}.`);
}

async function status(url) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    return `${response.status} ${response.ok ? "ready" : "error"}`;
  } catch {
    return "not reachable";
  }
}

async function hash(path) {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch {
    return null;
  }
}

async function toWsl(path) {
  return (await execFile("wslpath", ["-u", path], { encoding: "utf8" })).stdout.trim();
}

async function toWindows(path) {
  return (await execFile("wslpath", ["-w", path], { encoding: "utf8" })).stdout.trim();
}

async function readState() {
  try { return JSON.parse(await readFile(stateFile, "utf8")); } catch { return null; }
}

async function saveState() {
  await mkdir(stateDir, { recursive: true });
  const temporary = `${stateFile}.tmp`;
  await writeFile(temporary, `${JSON.stringify(context.state, null, 2)}\n`, "utf8");
  await rename(temporary, stateFile);
}

function assertWsl() {
  if (process.platform !== "linux" || !process.env.WSL_DISTRO_NAME) {
    throw new Error("Run this command inside the authoritative Ubuntu WSL checkout.");
  }
}

async function waitUntil(predicate, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await predicate()) return true;
    await delay(100);
  }
  return false;
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
