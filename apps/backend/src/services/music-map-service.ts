const ORIGIN = "https://www.music-map.com";
const DAY_MS = 86_400_000;
const MAX_BODY_BYTES = 256_000;

export interface MusicMapResult {
  artists: { name: string; url: string; rank: number }[];
  sourceUrl: string;
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", ouml: "ö", auml: "ä", uuml: "ü", eacute: "é" };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, key: string) => {
    if (!key.startsWith("#")) return named[key] ?? entity;
    const code = key[1]?.toLowerCase() === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
  });
}
function normalize(value: string): string {
  return value.normalize("NFKC").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}
function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/(?:^|\s)([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    result[match[1]!.toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}
function textContent(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}
export function musicMapUrl(name: string): string {
  return `${ORIGIN}/${encodeURIComponent(name.trim().toLowerCase()).replace(/%20/g, "+")}`;
}

/** Parse the public map markup, never the executable similarity/layout scripts. */
export function parseMusicMap(html: string, name: string): MusicMapResult {
  const sourceUrl = musicMapUrl(name);
  const map = [...html.matchAll(/<div\b([^>]*)>([\s\S]*?)<\/div\s*>/gi)]
    .find((match) => attributes(match[1]!).id === "gnodMap")?.[2];
  if (!map) throw new Error("Music-Map did not return an artist map");
  const links = [...map.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)]
    .map((match) => ({ attrs: attributes(match[1]!), name: textContent(match[2]!) }));
  const seed = links.find((link) => link.attrs.id === "s0");
  if (!seed || normalize(seed.name) !== normalize(name)) throw new Error("Music-Map returned a different artist");
  const title = [...html.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span\s*>/gi)]
    .find((match) => attributes(match[1]!).id === "the_title")?.[2];
  if (title && normalize(textContent(title)) !== normalize(name)) throw new Error("Music-Map returned a different artist title");
  const seen = new Set([normalize(name)]);
  const artists: MusicMapResult["artists"] = [];
  for (const link of links) {
    if (!/^s[1-9]\d*$/.test(link.attrs.id ?? "") || !link.name || link.name.length > 250 || seen.has(normalize(link.name))) continue;
    let url: URL;
    try { url = new URL(link.attrs.href ?? "", sourceUrl); } catch { continue; }
    if (!link.attrs.href || url.origin !== ORIGIN || url.username || url.password || url.search || url.hash || url.pathname === "/") continue;
    seen.add(normalize(link.name));
    artists.push({ name: link.name, url: url.href, rank: artists.length + 1 });
    if (artists.length === 100) break;
  }
  return { artists, sourceUrl };
}

/** A best-effort public-page adapter; Music-Map does not publish a supported API. */
export class MusicMapService {
  private readonly cache = new Map<string, { expires: number; result: MusicMapResult }>();
  private readonly pending = new Map<string, Promise<MusicMapResult>>();
  private readonly download: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  constructor(options: { fetch?: typeof fetch; now?: () => number; timeoutMs?: number; userAgent?: string } = {}) {
    this.download = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = Math.max(1, Math.min(3_000, options.timeoutMs ?? 3_000));
    this.userAgent = options.userAgent ?? "MusicOS/0.1";
  }
  async get(name: string): Promise<MusicMapResult> {
    name = name.trim();
    if (!name || name.length > 250 || /[\u0000-\u001f]/.test(name)) throw new Error("Invalid Music-Map artist name");
    const key = normalize(name);
    const cached = this.cache.get(key);
    if (cached && cached.expires > this.now()) return structuredClone(cached.result);
    let task = this.pending.get(key);
    if (!task) {
      task = this.load(name).then((result) => {
        this.cache.delete(key);
        this.cache.set(key, { result, expires: this.now() + DAY_MS });
        if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!);
        return result;
      }).finally(() => this.pending.delete(key));
      this.pending.set(key, task);
    }
    return structuredClone(await task);
  }
  private async load(name: string): Promise<MusicMapResult> {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { abort.abort(); reject(new Error("Music-Map request timed out")); }, this.timeoutMs);
    });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await this.download(musicMapUrl(name), {
          signal: abort.signal, redirect: "error", headers: { "User-Agent": this.userAgent, Accept: "text/html" },
        });
        if (!response.ok) throw new Error(`Music-Map returned HTTP ${response.status}`);
        if (!response.body) throw new Error("Music-Map returned an empty response");
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > MAX_BODY_BYTES) throw new Error("Music-Map response is too large");
            chunks.push(chunk.value);
          }
        } finally { await reader.cancel().catch(() => undefined); }
        return parseMusicMap(Buffer.concat(chunks).toString("utf8"), name);
      })()]);
    } finally {
      clearTimeout(timer);
      abort.abort();
    }
  }
}
