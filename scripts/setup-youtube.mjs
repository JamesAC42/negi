import { spawnSync } from "node:child_process";
import { mkdir, readFile, chmod, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = join(root, ".music-os", "tools", "youtube", "bin");
if (process.platform === "win32")
  throw new Error("Run npm run setup:youtube inside the Ubuntu WSL checkout.");
await mkdir(directory, { recursive: true });
const base = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";
function download(name, path) {
  const result = spawnSync(
    "curl",
    [
      "--ipv4",
      "--fail",
      "--location",
      "--retry",
      "3",
      "--max-time",
      "120",
      "--output",
      path,
      base + name,
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      "Could not download the official yt-dlp release. Retry when GitHub is reachable.",
    );
}
const staging = join(directory, "yt-dlp.download");
const sums = join(directory, "SHA2-256SUMS");
download("yt-dlp", staging);
download("SHA2-256SUMS", sums);
const expected = (await readFile(sums, "utf8"))
  .split("\n")
  .find((line) => line.trim().endsWith(" yt-dlp"))
  ?.split(/\s+/)[0];
const actual = createHash("sha256")
  .update(await readFile(staging))
  .digest("hex");
if (!expected || expected !== actual)
  throw new Error("yt-dlp checksum mismatch; installation was not activated.");
await chmod(staging, 0o755);
await rename(staging, join(directory, "yt-dlp"));
const version = spawnSync(join(directory, "yt-dlp"), ["--version"], {
  stdio: "inherit",
});
if (version.status !== 0)
  throw new Error("yt-dlp could not run. Python 3 is required.");
console.log(
  "YouTube tools ready. Restart the backend once if it was already running. Re-run this command to update.",
);
