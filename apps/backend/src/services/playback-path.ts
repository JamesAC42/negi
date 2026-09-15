import { execFile } from "node:child_process";
import { copyFile, link, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PreparedPlaybackPath {
  path: string;
  cleanup(): Promise<void>;
}

export function translatePathForPlayer(path: string, playerPath: string): string {
  if (!isWindowsPlayer(playerPath)) return path;
  const mount = path.match(/^\/mnt\/([a-z])\/(.*)$/i);
  return mount ? mount[1].toUpperCase() + ":\\" + mount[2].replaceAll("/", "\\") : path;
}

export function needsSafePlaybackPath(path: string, playerPath: string): boolean {
  if (!isWindowsPlayer(playerPath)) return false;
  if (process.platform !== "win32" && path.startsWith("/") && !/^\/mnt\/[a-z]\//i.test(path)) return true;
  return path.split(/[\\/]/).some((part) => part !== "." && part !== ".." && /[. ]$/.test(part));
}

/** Windows mpv normalizes even extended paths, breaking WSL-created trailing dots.
 * A disposable Windows-temp alias keeps the original library file untouched. */
export async function preparePlaybackPath(
  path: string,
  playerPath: string,
  windowsNodePath?: string | null
): Promise<PreparedPlaybackPath> {
  if (!needsSafePlaybackPath(path, playerPath)) {
    return { path: translatePathForPlayer(path, playerPath), cleanup: async () => {} };
  }

  let temporaryRoot = tmpdir();
  if (process.platform !== "win32") {
    const { stdout } = await execFileAsync(
      windowsNodePath ?? "node.exe",
      ["-e", 'process.stdout.write(require("node:os").tmpdir())'],
      { timeout: 10_000 }
    );
    const drive = stdout.trim().match(/^([a-z]):[\\/](.*)$/i);
    if (!drive) throw new Error("Windows playback temporary directory must be on a local drive");
    temporaryRoot = "/mnt/" + drive[1].toLowerCase() + "/" + drive[2].replaceAll("\\", "/");
  }

  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(join(temporaryRoot, "music-os-playback-"));
  const cleanup = async () => { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); };
  const safeExtension = /^\.[a-z0-9]+$/i.test(extname(path)) ? extname(path) : ".audio";
  const alias = join(directory, "track" + safeExtension);
  try {
    try {
      await link(path, alias);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      await copyFile(path, alias);
    }
    return { path: translatePathForPlayer(alias, playerPath), cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

function isWindowsPlayer(path: string): boolean {
  return path.toLowerCase().endsWith(".exe");
}
