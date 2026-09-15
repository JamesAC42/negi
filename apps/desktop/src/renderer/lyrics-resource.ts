import { useEffect, useState } from "react";
import { lyricsResponseSchema, type LyricsResponse } from "@music-os/core";
export type LyricsFailure = "backend_outdated" | "file_missing" | "connection" | "provider";
class LyricsRequestError extends Error {
  constructor(readonly reason: LyricsFailure) { super(reason); }
}

export async function fetchLyrics(fileId: string, signal: AbortSignal): Promise<LyricsResponse> {
  const response = await fetch(`http://127.0.0.1:47831/library/files/${encodeURIComponent(fileId)}/lyrics`, { signal });
  const value: unknown = await response.json();
  if (!response.ok) {
    if (response.status === 404) {
      const missingRoute = value != null && typeof value === "object" && "error" in value && value.error === "not_found";
      throw new LyricsRequestError(missingRoute ? "backend_outdated" : "file_missing");
    }
    throw new LyricsRequestError("connection");
  }
  const result = lyricsResponseSchema.parse(value);
  if (result.fileId !== fileId) throw new Error("Lyrics belong to another track");
  return result;
}

// Session reuse makes switching/reopening instant. The backend owns durable
// storage, including misses; song metadata is part of both cache identities.
const requests = new Map<string, Promise<LyricsResponse>>();
const maxEntries = 64;
function requestLyrics(key: string, fileId: string): Promise<LyricsResponse> {
  const existing = requests.get(key);
  if (existing) return existing;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 6500);
  const request = fetchLyrics(fileId, controller.signal)
    .then(result => {
      if (result.status === "error") requests.delete(key);
      return result;
    }).catch(error => { requests.delete(key); throw error; })
    .finally(() => window.clearTimeout(timeout));
  requests.set(key, request);
  if (requests.size > maxEntries) requests.delete(requests.keys().next().value!);
  return request;
}

type Resource = { key: string; result: LyricsResponse | null; failure: LyricsFailure | null; retryAt: number };
export function useLyrics(key: string, fileId: string | null, enabled: boolean) {
  const [resource, setResource] = useState<Resource | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled || !fileId) return;
    let disposed = false;
    setResource({ key, result: null, failure: null, retryAt: 0 });
    void requestLyrics(key, fileId).then(result => {
      if (!disposed) setResource({ key, result, failure: result.status === "error" ? "provider" : null,
        retryAt: result.status === "error" ? Date.now() + (result.retryAfterMs ?? 5000) : 0 });
    }).catch(error => {
      if (!disposed) setResource({ key, result: null, failure: error instanceof LyricsRequestError ? error.reason : "connection", retryAt: Date.now() + 5000 });
    });
    return () => { disposed = true; };
  }, [key, fileId, enabled, attempt]);
  const current = resource?.key === key ? resource : null;
  const retryAt = current?.retryAt ?? 0;
  useEffect(() => {
    if (!retryAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= retryAt) clearInterval(timer);
    }, 500);
    return () => clearInterval(timer);
  }, [retryAt]);
  return {
    result: current?.result ?? null,
    failed: current?.failure != null,
    failure: current?.failure ?? null,
    retrySeconds: Math.max(0, Math.ceil((retryAt - now) / 1000)),
    retry: () => { if (Date.now() >= retryAt) setAttempt(value => value + 1); },
  };
}
