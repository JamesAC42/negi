import { spawn } from "node:child_process";
import { getBackendConfig } from "../config.js";

const config = getBackendConfig();

const child = spawn(config.mpvPath, ["--version"], {
  stdio: ["ignore", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";

child.stdout.on("data", (chunk: Buffer) => {
  stdout += chunk.toString("utf8");
});

child.stderr.on("data", (chunk: Buffer) => {
  stderr += chunk.toString("utf8");
});

child.on("error", (error) => {
  console.error(`Unable to start mpv at "${config.mpvPath}": ${error.message}`);
  process.exit(1);
});

child.on("close", (code) => {
  if (code !== 0) {
    console.error(`mpv check failed with exit code ${code ?? "unknown"}`);
    if (stderr.trim()) {
      console.error(stderr.trim());
    }
    process.exit(1);
  }

  const firstLine = stdout.split(/\r?\n/).find(Boolean) ?? "mpv responded";
  console.log(`mpv ok: ${firstLine}`);
  console.log(`mpv path: ${config.mpvPath}`);
});
