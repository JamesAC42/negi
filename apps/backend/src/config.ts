import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, "..");
const repoRoot = join(__dirname, "..", "..", "..");

loadEnv({ path: join(repoRoot, ".env"), override: true, quiet: true });
loadEnv({ path: join(backendRoot, ".env"), override: true, quiet: true });

export interface BackendConfig {
  host: string;
  port: number;
  databasePath: string;
  mpvPath: string;
  musicBrainzEnabled?: boolean;
  musicBrainzUserAgent?: string;
  fpcalcPath?: string | null;
  ffmpegPath?: string | null;
  slskdUrl?: string | null;
  slskdApiKey?: string | null;
  slskdUsername?: string | null;
  slskdPassword?: string | null;
  slskdDownloadDirectory?: string | null;
}

export function getBackendConfig(): BackendConfig {
  return {
    host: process.env.MUSIC_OS_HOST ?? "127.0.0.1",
    port: Number(process.env.MUSIC_OS_PORT ?? 47831),
    databasePath:
      process.env.MUSIC_OS_DATABASE_PATH ??
      join(process.cwd(), ".music-os", "music-os.sqlite"),
    mpvPath: process.env.MUSIC_OS_MPV_PATH ?? detectDefaultMpvPath(),
    musicBrainzEnabled: process.env.MUSIC_OS_MUSICBRAINZ_ENABLED !== "0",
    musicBrainzUserAgent: process.env.MUSIC_OS_MUSICBRAINZ_USER_AGENT ?? "MusicOS/0.1.0 (local-dev)",
    fpcalcPath: process.env.MUSIC_OS_FPCALC_PATH ?? detectFpcalcPath(),
    ffmpegPath: process.env.MUSIC_OS_FFMPEG_PATH ?? detectFfmpegPath(),
    slskdUrl: process.env.MUSIC_OS_SLSKD_URL ?? "http://127.0.0.1:5030",
    slskdApiKey: process.env.MUSIC_OS_SLSKD_API_KEY ?? null,
    slskdUsername: process.env.MUSIC_OS_SLSKD_USERNAME ?? null,
    slskdPassword: process.env.MUSIC_OS_SLSKD_PASSWORD ?? null,
    slskdDownloadDirectory: process.env.MUSIC_OS_SLSKD_DOWNLOAD_DIR
      ? normalizeClientPath(process.env.MUSIC_OS_SLSKD_DOWNLOAD_DIR)
      : null
  };
}

function detectDefaultMpvPath(): string {
  const candidates = [
    "/mnt/c/Program Files/mpv-x86_64-20181002/mpv.exe",
    "/mnt/c/Program Files/mpv/mpv.exe",
    "/mnt/c/Program Files (x86)/mpv/mpv.exe"
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? "mpv";
}

function detectFpcalcPath(): string | null {
  const candidates = ["/usr/bin/fpcalc", "/usr/local/bin/fpcalc"];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function detectFfmpegPath(): string | null {
  const candidates = [
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/mnt/c/Program Files/ffmpeg/bin/ffmpeg.exe",
    "/mnt/c/Program Files (x86)/ffmpeg/bin/ffmpeg.exe"
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function normalizeClientPath(path: string): string {
  const trimmed = path.trim();
  const windowsDrive = trimmed.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (!windowsDrive) {
    return trimmed.replaceAll("\\", "/");
  }

  return `/mnt/${windowsDrive[1].toLowerCase()}/${windowsDrive[2].replaceAll("\\", "/")}`;
}
