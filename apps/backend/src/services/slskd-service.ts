import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import type { DiscoveryHealthResponse, DiscoveryResult, DiscoverySearchResponse } from "@music-os/core";
import type { BackendConfig } from "../config.js";

export interface SlskdDownloadInspection {
  downloadDirectory: string;
  directoryError: string | null;
  filesSeen: number;
  completedPaths: string[];
  transfers: {
    total: number;
    matched: number;
    completed: number;
    failed: number;
    active: number;
    queued: number;
    other: number;
    samples: SlskdTransferSummary[];
    error: string | null;
  };
}

export interface SlskdTransferSummary {
  username: string | null;
  filename: string;
  state: string;
  message: string | null;
  paths: string[];
}

export class SlskdService {
  constructor(private readonly config: BackendConfig) {}

  async health(): Promise<DiscoveryHealthResponse> {
    if (!this.config.slskdUrl) {
      return {
        configured: false,
        reachable: false,
        downloadsConfigured: false,
        url: null,
        message: "slskd URL is not configured"
      };
    }

    try {
      const response = await this.fetchJson("/api/v0/application", { method: "GET" });
      return {
        configured: true,
        reachable: true,
        downloadsConfigured: Boolean(this.config.slskdDownloadDirectory),
        url: this.config.slskdUrl,
        message: sessionMessage(response)
      };
    } catch (error) {
      return {
        configured: true,
        reachable: false,
        downloadsConfigured: Boolean(this.config.slskdDownloadDirectory),
        url: this.config.slskdUrl,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async search(query: string, responseLimit = 100): Promise<DiscoverySearchResponse> {
    const searchTimeout = slskdSearchTimeoutMs();
    const payload = {
      searchText: query,
      fileLimit: 10000,
      filterResponses: true,
      responseLimit,
      searchTimeout
    };
    const created = await this.fetchJson("/api/v0/searches", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const searchId = searchIdFromResponse(created);
    const response = searchId ? await this.waitForSearch(searchId, searchTimeout, responseLimit) : created;
    const results = extractResults(response);
    return {
      query,
      results,
      total: results.length
    };
  }

  async download(results: DiscoveryResult[]): Promise<{ queued: number; completedPaths: string[] }> {
    const unlocked = await this.queueDownloadResults(results);
    await this.waitForDownloads(unlocked);
    const completedPaths = await this.findCompletedDownloadPaths(unlocked);
    return {
      queued: unlocked.length,
      completedPaths
    };
  }

  async queueDownloadResults(results: DiscoveryResult[]): Promise<DiscoveryResult[]> {
    if (!this.config.slskdDownloadDirectory) {
      throw new Error("MUSIC_OS_SLSKD_DOWNLOAD_DIR is required before downloads can be staged");
    }

    const unlocked = results.filter((result) => !result.isLocked && isAudioDiscoveryResult(result));
    if (unlocked.length === 0) {
      throw new Error("No unlocked audio discovery results were selected");
    }

    for (const [username, files] of groupByUsername(unlocked)) {
      await this.fetchJson(`/api/v0/transfers/downloads/${encodeURIComponent(username)}`, {
        method: "POST",
        body: JSON.stringify(files.map(toSlskdDownloadFile))
      });
    }

    return unlocked;
  }

  async findCompletedDownloadPaths(results: DiscoveryResult[]): Promise<string[]> {
    if (!this.config.slskdDownloadDirectory) {
      throw new Error("MUSIC_OS_SLSKD_DOWNLOAD_DIR is required before downloads can be staged");
    }
    return findDownloadedFiles(this.config.slskdDownloadDirectory, results);
  }

  async inspectDownloadResults(results: DiscoveryResult[]): Promise<SlskdDownloadInspection> {
    if (!this.config.slskdDownloadDirectory) {
      throw new Error("MUSIC_OS_SLSKD_DOWNLOAD_DIR is required before downloads can be staged");
    }

    let files: DownloadedFile[] = [];
    let directoryError: string | null = null;
    try {
      files = await listFiles(this.config.slskdDownloadDirectory);
    } catch (error) {
      directoryError = error instanceof Error ? error.message : String(error);
    }

    const completedPaths = matchDownloadedFiles(files, results);
    const transfers = await this.inspectTransfers(results);
    return {
      downloadDirectory: this.config.slskdDownloadDirectory,
      directoryError,
      filesSeen: files.length,
      completedPaths,
      transfers
    };
  }

  async inspectTransferRecords(results: DiscoveryResult[]): Promise<Record<string, unknown>[]> {
    return (await this.listTransferRecords()).filter((transfer) => transferMatchesAnyResult(transfer, results));
  }

  async listTransferRecords(): Promise<Record<string, unknown>[]> {
    const response = await this.fetchJson("/api/v0/transfers/downloads", { method: "GET" });
    return collectTransferFiles(response);
  }

  private async waitForSearch(searchId: string, timeoutMs: number, responseLimit: number): Promise<unknown> {
    let latest: unknown = {};
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs + slskdSearchGraceMs();
    for (let attempt = 0; Date.now() < deadline; attempt += 1) {
      await delay(searchPollDelayMs(attempt));
      latest = await this.fetchJson(`/api/v0/searches/${encodeURIComponent(searchId)}?includeResponses=true`, {
        method: "GET"
      });
      const state = asRecord(latest);
      const results = extractResults(latest);
      if (state && (state.isComplete === true || stringValue(state.state)?.toLowerCase().includes("completed"))) {
        if (results.length === 0 && searchReportedResultCount(state) > 0 && Date.now() < deadline) {
          continue;
        }
        return latest;
      }
      if (results.length >= responseLimit || (results.length > 0 && Date.now() - startedAt >= slskdSearchPartialAfterMs())) {
        return latest;
      }
    }

    return latest;
  }

  private async waitForDownloads(results: DiscoveryResult[]): Promise<void> {
    const expected = new Set(results.map((result) => result.id));
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await delay(attempt === 0 ? 1000 : 2000);
      if (this.config.slskdDownloadDirectory) {
        const completedPaths = await findDownloadedFiles(this.config.slskdDownloadDirectory, results);
        if (completedPaths.length > 0) {
          return;
        }
      }
      const transfers = await this.fetchJson("/api/v0/transfers/downloads", { method: "GET" });
      const completed = collectTransferFiles(transfers)
        .filter((transfer) => isCompletedTransfer(transfer))
        .map((transfer) => transferToDiscoveryId(transfer))
        .filter((id): id is string => id != null);
      if (completed.some((id) => expected.has(id))) {
        return;
      }
    }
  }

  private async inspectTransfers(results: DiscoveryResult[]): Promise<SlskdDownloadInspection["transfers"]> {
    try {
      const response = await this.fetchJson("/api/v0/transfers/downloads", { method: "GET" });
      const transfers = collectTransferFiles(response);
      const matched = transfers.filter((transfer) => transferMatchesAnyResult(transfer, results));
      const counts = {
        completed: 0,
        failed: 0,
        active: 0,
        queued: 0,
        other: 0
      };

      for (const transfer of matched) {
        const state = transferState(transfer);
        if (isCompletedState(state)) {
          counts.completed += 1;
        } else if (isFailedState(state)) {
          counts.failed += 1;
        } else if (isQueuedState(state)) {
          counts.queued += 1;
        } else if (isActiveState(state)) {
          counts.active += 1;
        } else {
          counts.other += 1;
        }
      }

      return {
        total: transfers.length,
        matched: matched.length,
        completed: counts.completed,
        failed: counts.failed,
        active: counts.active,
        queued: counts.queued,
        other: counts.other,
        samples: matched.slice(0, 8).map(transferToSummary),
        error: null
      };
    } catch (error) {
      return {
        total: 0,
        matched: 0,
        completed: 0,
        failed: 0,
        active: 0,
        queued: 0,
        other: 0,
        samples: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async fetchJson(path: string, init: RequestInit): Promise<unknown> {
    if (!this.config.slskdUrl) {
      throw new Error("slskd URL is not configured");
    }

    const response = await fetch(new URL(path, ensureTrailingSlash(this.config.slskdUrl)), {
      ...init,
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        ...authHeaders(this.config),
        ...init.headers
      },
      signal: AbortSignal.timeout(20000)
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(formatSlskdHttpError(response.status, text));
    }
    if (!text.trim()) {
      return {};
    }
    return JSON.parse(text) as unknown;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slskdSearchTimeoutMs(): number {
  return readPositiveIntegerEnv("MUSIC_OS_SLSKD_SEARCH_TIMEOUT_MS", 20_000);
}

function slskdSearchGraceMs(): number {
  return readPositiveIntegerEnv("MUSIC_OS_SLSKD_SEARCH_GRACE_MS", 5_000);
}

function slskdSearchPartialAfterMs(): number {
  return readPositiveIntegerEnv("MUSIC_OS_SLSKD_SEARCH_PARTIAL_AFTER_MS", 2_500);
}

function searchPollDelayMs(attempt: number): number {
  if (attempt === 0) {
    return readPositiveIntegerEnv("MUSIC_OS_SLSKD_SEARCH_INITIAL_POLL_MS", 150);
  }
  return Math.min(readPositiveIntegerEnv("MUSIC_OS_SLSKD_SEARCH_POLL_MAX_MS", 900), 250 + attempt * 150);
}

function searchReportedResultCount(state: Record<string, unknown>): number {
  return (
    numberValue(state.fileCount) ??
    ((numberValue(state.responseCount) ?? 0) + (numberValue(state.lockedFileCount) ?? 0))
  );
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function searchIdFromResponse(value: unknown): string | null {
  const record = asRecord(value);
  return record ? stringValue(record.id) : null;
}

function groupByUsername(results: DiscoveryResult[]): Map<string, DiscoveryResult[]> {
  const grouped = new Map<string, DiscoveryResult[]>();
  for (const result of results) {
    if (!result.username) {
      throw new Error(`Discovery result is missing a username: ${result.filename}`);
    }
    grouped.set(result.username, [...(grouped.get(result.username) ?? []), result]);
  }
  return grouped;
}

function toSlskdDownloadFile(result: DiscoveryResult): Record<string, unknown> {
  const filename = stringValue(result.raw.filename) ?? result.path;
  const size = numberValue(result.raw.size) ?? result.sizeBytes ?? undefined;
  return {
    filename,
    size
  };
}

function isAudioDiscoveryResult(result: DiscoveryResult): boolean {
  const extension = result.extension ?? extname(result.filename || result.path).replace(/^\./, "");
  return audioExtensions.has(extension.toLowerCase());
}

const audioExtensions = new Set([
  "aac",
  "aiff",
  "alac",
  "ape",
  "dsf",
  "flac",
  "m4a",
  "mp3",
  "ogg",
  "opus",
  "wav",
  "wma"
]);

function authHeaders(config: BackendConfig): Record<string, string> {
  if (config.slskdApiKey) {
    return {
      authorization: `Bearer ${config.slskdApiKey}`,
      "x-api-key": config.slskdApiKey
    };
  }
  if (config.slskdUsername && config.slskdPassword) {
    const encoded = Buffer.from(`${config.slskdUsername}:${config.slskdPassword}`).toString("base64");
    return { authorization: `Basic ${encoded}` };
  }
  return {};
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function formatSlskdHttpError(status: number, body: string): string {
  const message = parseErrorMessage(body);
  return message ? `slskd request failed with ${status}: ${message}` : `slskd request failed with ${status}`;
}

function parseErrorMessage(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const record = asRecord(parsed);
    const message = record ? stringValue(record.message ?? record.error ?? record.detail ?? record.title) : null;
    if (message) {
      return message;
    }
  } catch {
    // Fall through to plain text.
  }
  return trimmed.length > 500 ? `${trimmed.slice(0, 500)}...` : trimmed;
}

function sessionMessage(value: unknown): string | null {
  if (typeof value !== "object" || value == null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const server = asRecord(record.server);
  if (server) {
    const state = stringValue(server.state ?? server.status);
    const endpoint = stringValue(server.ipEndPoint ?? server.endpoint ?? server.address);
    if (state && endpoint) {
      return `${state} (${endpoint})`;
    }
    if (state) {
      return state;
    }
  }
  const username = stringValue(record.username ?? record.user);
  const state = stringValue(record.state ?? record.status);
  if (username && state) {
    return `${username}: ${state}`;
  }
  return state ?? username ?? "slskd API reachable";
}

function extractResults(value: unknown): DiscoveryResult[] {
  const results: DiscoveryResult[] = [];
  const root = asRecord(value);
  if (!root) {
    return results;
  }

  const responses = arrayValue(root.responses ?? root.results ?? root.items);
  for (const response of responses) {
    const responseRecord = asRecord(response);
    if (!responseRecord) {
      continue;
    }
    const username = stringValue(responseRecord.username ?? responseRecord.user ?? responseRecord.userName);
    const availability = peerAvailability(responseRecord);
    const files = arrayValue(responseRecord.files ?? responseRecord.results ?? responseRecord.items);
    for (const file of files) {
      const result = mapFileResult(file, username, availability);
      if (result) {
        results.push(result);
      }
    }
    for (const file of arrayValue(responseRecord.lockedFiles)) {
      const result = mapFileResult(file, username, availability, true);
      if (result) {
        results.push(result);
      }
    }
  }

  if (results.length === 0) {
    for (const file of arrayValue(root.files ?? root.results)) {
      const result = mapFileResult(file, null, emptyPeerAvailability);
      if (result) {
        results.push(result);
      }
    }
    for (const file of arrayValue(root.lockedFiles)) {
      const result = mapFileResult(file, null, emptyPeerAvailability, true);
      if (result) {
        results.push(result);
      }
    }
  }

  return dedupeResults(results);
}

interface PeerAvailability {
  hasFreeUploadSlot: boolean | null;
  uploadSpeedBytesPerSecond: number | null;
  queueLength: number | null;
}

const emptyPeerAvailability: PeerAvailability = {
  hasFreeUploadSlot: null,
  uploadSpeedBytesPerSecond: null,
  queueLength: null
};

function peerAvailability(response: Record<string, unknown>): PeerAvailability {
  return {
    hasFreeUploadSlot: booleanValue(response.hasFreeUploadSlot ?? response.freeUploadSlot ?? response.slotsFree),
    uploadSpeedBytesPerSecond: numberValue(response.uploadSpeed ?? response.avgSpeed ?? response.averageSpeed),
    queueLength: numberValue(response.queueLength ?? response.queueDepth)
  };
}

function mapFileResult(value: unknown, username: string | null, availability: PeerAvailability, isLocked = false): DiscoveryResult | null {
  const file = asRecord(value);
  if (!file) {
    return null;
  }

  const filename = stringValue(file.filename ?? file.fileName ?? file.name ?? file.path);
  const path = stringValue(file.path ?? file.filename ?? file.fileName ?? file.name);
  if (!filename || !path) {
    return null;
  }

  const resolvedUsername = stringValue(file.username ?? file.user ?? file.userName) ?? username;
  const extension = extname(filename).replace(/^\./, "").toLowerCase() || null;
  return {
    id: stableId([resolvedUsername ?? "", path, String(numberValue(file.size ?? file.sizeBytes) ?? "")]),
    source: "slskd",
    username: resolvedUsername,
    filename: basenameFromSlskdPath(filename),
    path,
    folder: folderFromSlskdPath(path),
    sizeBytes: numberValue(file.size ?? file.sizeBytes),
    extension,
    bitrate: numberValue(file.bitRate ?? file.bitrate),
    sampleRate: numberValue(file.sampleRate),
    lengthSeconds: numberValue(file.length ?? file.duration ?? file.durationSeconds),
    isLocked: isLocked || (booleanValue(file.isLocked ?? file.locked) ?? false),
    hasFreeUploadSlot: availability.hasFreeUploadSlot,
    uploadSpeedBytesPerSecond: availability.uploadSpeedBytesPerSecond,
    queueLength: availability.queueLength,
    raw: file
  };
}

function dedupeResults(results: DiscoveryResult[]): DiscoveryResult[] {
  const seen = new Set<string>();
  const deduped: DiscoveryResult[] = [];
  for (const result of results) {
    if (seen.has(result.id)) {
      continue;
    }
    seen.add(result.id);
    deduped.push(result);
  }
  return deduped;
}

function collectTransferFiles(value: unknown): Record<string, unknown>[] {
  const files: Record<string, unknown>[] = [];
  collectTransferFilesInner(value, files);
  return files;
}

function collectTransferFilesInner(value: unknown, files: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTransferFilesInner(item, files);
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  if (stringValue(record.filename ?? record.fileName ?? record.path)) {
    files.push(record);
  }

  for (const childKey of ["files", "items", "transfers", "directories", "children"]) {
    collectTransferFilesInner(record[childKey], files);
  }
}

function isCompletedTransfer(transfer: Record<string, unknown>): boolean {
  return isCompletedState(transferState(transfer));
}

function transferToDiscoveryId(transfer: Record<string, unknown>): string | null {
  const username = stringValue(transfer.username ?? transfer.user ?? transfer.userName);
  const path = stringValue(transfer.filename ?? transfer.fileName ?? transfer.path);
  const size = numberValue(transfer.size ?? transfer.sizeBytes);
  if (!path) {
    return null;
  }
  return stableId([username ?? "", path, String(size ?? "")]);
}

async function findDownloadedFiles(downloadDirectory: string, results: DiscoveryResult[]): Promise<string[]> {
  const candidates = await listFiles(downloadDirectory);
  return matchDownloadedFiles(candidates, results);
}

function matchDownloadedFiles(candidates: DownloadedFile[], results: DiscoveryResult[]): string[] {
  const matched = new Set<string>();
  for (const result of results) {
    const basename = basenameFromSlskdPath(result.path).toLowerCase();
    const match = candidates.find((candidate) => {
      if (basenameFromSlskdPath(candidate.path).toLowerCase() !== basename) {
        return false;
      }
      return result.sizeBytes == null || candidate.sizeBytes === result.sizeBytes;
    });
    if (match) {
      matched.add(match.path);
    }
  }
  return [...matched];
}

interface DownloadedFile {
  path: string;
  sizeBytes: number;
}

async function listFiles(directory: string): Promise<DownloadedFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: DownloadedFile[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
      continue;
    }
    if (entry.isFile()) {
      const fileStat = await stat(path);
      files.push({ path, sizeBytes: fileStat.size });
    }
  }
  return files;
}

function transferMatchesAnyResult(transfer: Record<string, unknown>, results: DiscoveryResult[]): boolean {
  return results.some((result) => transferMatchesResult(transfer, result));
}

function transferMatchesResult(transfer: Record<string, unknown>, result: DiscoveryResult): boolean {
  const transferId = transferToDiscoveryId(transfer);
  if (transferId && transferId === result.id) {
    return true;
  }

  const path = stringValue(transfer.filename ?? transfer.fileName ?? transfer.path);
  if (!path) {
    return false;
  }
  if (basenameFromSlskdPath(path).toLowerCase() !== basenameFromSlskdPath(result.path).toLowerCase()) {
    return false;
  }

  const transferSize = numberValue(transfer.size ?? transfer.sizeBytes);
  if (result.sizeBytes != null && transferSize != null && result.sizeBytes !== transferSize) {
    return false;
  }

  const username = stringValue(transfer.username ?? transfer.user ?? transfer.userName);
  return !username || !result.username || username === result.username;
}

function transferToSummary(transfer: Record<string, unknown>): SlskdTransferSummary {
  const filename = stringValue(transfer.filename ?? transfer.fileName ?? transfer.path) ?? "unknown file";
  return {
    username: stringValue(transfer.username ?? transfer.user ?? transfer.userName),
    filename: basenameFromSlskdPath(filename),
    state: transferState(transfer),
    message: stringValue(transfer.message ?? transfer.error ?? transfer.reason),
    paths: transferPathValues(transfer)
  };
}

function transferPathValues(transfer: Record<string, unknown>): string[] {
  const values = new Set<string>();
  for (const key of [
    "filename",
    "fileName",
    "path",
    "localPath",
    "localFilename",
    "localFileName",
    "downloadPath",
    "destination",
    "destinationPath",
    "file",
    "fullPath",
    "incompleteFile",
    "incompletePath",
    "target"
  ]) {
    const value = stringValue(transfer[key]);
    if (value) {
      values.add(value);
    }
  }
  return [...values];
}

function transferState(transfer: Record<string, unknown>): string {
  return stringValue(transfer.state ?? transfer.status) ?? "unknown";
}

function isCompletedState(state: string): boolean {
  const normalized = state.toLowerCase();
  return /complete|completed|succeed|succeeded|success|finished/.test(normalized) && !isFailedState(normalized);
}

function isFailedState(state: string): boolean {
  return /fail|failed|error|errored|cancel|cancelled|canceled|aborted|rejected/.test(state.toLowerCase());
}

function isQueuedState(state: string): boolean {
  return /queue|queued|pending|requested|initializ/.test(state.toLowerCase());
}

function isActiveState(state: string): boolean {
  return /active|running|downloading|inprogress|in progress|transferring/.test(state.toLowerCase());
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function basenameFromSlskdPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function folderFromSlskdPath(path: string): string | null {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 1) {
    return null;
  }
  return parts.slice(0, -1).join("\\");
}

function stableId(parts: string[]): string {
  return Buffer.from(parts.join("\0")).toString("base64url");
}
