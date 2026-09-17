import { useEffect, useRef, useState } from "react";
export async function exploreApi<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(
    "http://127.0.0.1:47831" + path,
    body === undefined
      ? { signal }
      : {
          signal,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.message || value.error || "Request failed");
  return value as T;
}
export const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : String(e);
export const libraryChanged = () =>
  window.dispatchEvent(new Event("music-library-changed"));
export const identityKey = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export function useExploreJobs<T extends { id: string; status: string }>(
  path: string,
) {
  const [jobs, setJobs] = useState<T[]>([]);
  const [error, setError] = useState("");
  const previous = useRef(new Map<string, string>());
  useEffect(() => {
    let live = true;
    let pending = false;
    let snapshot = "";
    const controller = new AbortController();
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const data = await exploreApi<{ jobs: T[] }>(path, undefined, controller.signal);
        if (!live) return;
        let completed = false;
        for (const j of data.jobs)
          if (
            j.status === "succeeded" &&
            previous.current.has(j.id) &&
            previous.current.get(j.id) !== "succeeded"
          )
            completed = true;
        previous.current = new Map(data.jobs.map((j) => [j.id, j.status]));
        const nextSnapshot = JSON.stringify(data.jobs);
        if (nextSnapshot !== snapshot) {
          snapshot = nextSnapshot;
          setJobs(data.jobs);
        }
        if (completed) libraryChanged();
        setError("");
      } catch (e) {
        if (live) setError(errorMessage(e));
      } finally {
        pending = false;
      }
    }
    void refresh();
    const onChanged = () => void refresh();
    window.addEventListener("explore-jobs-changed", onChanged);
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => {
      live = false;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("explore-jobs-changed", onChanged);
    };
  }, [path]);
  return { jobs, error };
}
