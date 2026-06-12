import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BackendConfig } from "../config.js";

const execFileAsync = promisify(execFile);

export interface AcousticFingerprint {
  algorithm: "chromaprint";
  fingerprint: string;
  durationMs: number | null;
}

export class AcousticFingerprintService {
  constructor(private readonly config: BackendConfig) {}

  get available(): boolean {
    return Boolean(this.config.fpcalcPath);
  }

  async fingerprint(filePath: string): Promise<AcousticFingerprint | null> {
    if (!this.config.fpcalcPath) {
      return null;
    }

    try {
      const { stdout } = await execFileAsync(this.config.fpcalcPath, ["-json", filePath], { timeout: 15000 });
      const parsed = JSON.parse(stdout) as { fingerprint?: unknown; duration?: unknown };
      if (typeof parsed.fingerprint !== "string" || parsed.fingerprint.length === 0) {
        return null;
      }

      const duration = typeof parsed.duration === "number" && Number.isFinite(parsed.duration) ? Math.round(parsed.duration * 1000) : null;
      return {
        algorithm: "chromaprint",
        fingerprint: parsed.fingerprint,
        durationMs: duration
      };
    } catch {
      return null;
    }
  }
}
