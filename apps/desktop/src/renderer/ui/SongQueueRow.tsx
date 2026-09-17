import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, ChevronRight, ListEnd, ListMusic, ListStart, Search } from "lucide-react";
import type { Playlist } from "@music-os/core";
import "./transitions-tokens.css";
import "./song-queue-menu.css";

type QueueInsertPosition = "up_next" | "end";

export const SongPlaylistContext = createContext<{
  playlists: Playlist[];
  status: "loading" | "ready" | "error";
  onRefresh(): Promise<void>;
  onAdd(playlistId: string, fileId: string): Promise<"added" | "existing">;
} | null>(null);

type Props = HTMLAttributes<HTMLDivElement> & {
  fileId: string;
  songTitle: string;
  queueDisabled: boolean;
  onEnqueue(fileIds: string[], position: QueueInsertPosition): Promise<void>;
};

/** Shared song actions, with a searchable playlist picker that stays on the current page. */
export function SongQueueRow({ fileId, songTitle, queueDisabled, onEnqueue, children, onKeyDown, ...props }: Props) {
  const playlists = useContext(SongPlaylistContext);
  const rowRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const requestId = useRef(0);
  const savingRef = useRef(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const matches = playlists?.playlists.filter((playlist) => playlist.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? [];

  useEffect(() => () => {
    clearTimeout(closeTimer.current);
    requestId.current++;
  }, []);

  function close(restoreFocus = false) {
    const menu = menuRef.current;
    if (!menu || menu.classList.contains("is-closing")) return;
    menu.classList.remove("is-open");
    menu.classList.add("is-closing");
    const value = getComputedStyle(menu).getPropertyValue("--dropdown-close-dur").trim();
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0 : (parseFloat(value) || 150) * (value.endsWith("ms") ? 1 : 1000);
    closeTimer.current = setTimeout(() => {
      menu.classList.remove("is-closing");
      setAnchor(null);
    }, duration);
    if (restoreFocus) (returnFocusRef.current?.isConnected ? returnFocusRef.current : rowRef.current)?.focus({ preventScroll: true });
  }

  function open(x: number, y: number) {
    clearTimeout(closeTimer.current);
    requestId.current++;
    savingRef.current = false;
    returnFocusRef.current = document.activeElement instanceof HTMLElement && rowRef.current?.contains(document.activeElement)
      ? document.activeElement : rowRef.current;
    setPicker(false);
    setQuery("");
    setSaving(null);
    setNotice(null);
    setAddedIds([]);
    setAnchor({ x, y });
  }

  async function addToPlaylist(playlist: Playlist) {
    if (!playlists || savingRef.current) return;
    savingRef.current = true;
    menuRef.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    const id = requestId.current;
    setSaving(playlist.id);
    setNotice(null);
    try {
      const result = await playlists.onAdd(playlist.id, fileId);
      if (id !== requestId.current) return;
      setAddedIds((current) => [...current, playlist.id]);
      setNotice({ text: result === "existing" ? `Already in ${playlist.name}` : `Added to ${playlist.name}`, error: false });
    } catch (error) {
      if (id !== requestId.current) return;
      setNotice({ text: error instanceof Error ? error.message : "Couldn't add this song. Please try again.", error: true });
    } finally {
      if (id === requestId.current) {
        savingRef.current = false;
        setSaving(null);
      }
    }
  }

  useLayoutEffect(() => {
    if (!anchor) return;
    const menu = menuRef.current!;
    const position = () => {
      const left = Math.max(8, Math.min(anchor.x, window.innerWidth - menu.offsetWidth - 8));
      const top = Math.max(8, Math.min(anchor.y, window.innerHeight - menu.offsetHeight - 8));
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      menu.dataset.origin = `${top < anchor.y ? "bottom" : "top"}-${left < anchor.x ? "right" : "left"}`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(menu);
    menu.classList.remove("is-open", "is-closing");
    void menu.offsetWidth;
    menu.classList.add("is-open");
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    const dismiss = () => close();
    const outside = (event: Event) => {
      if (!menu.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("contextmenu", outside);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", outside, true);
    window.addEventListener("blur", dismiss);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("contextmenu", outside);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", outside, true);
      window.removeEventListener("blur", dismiss);
    };
  }, [anchor]);

  useLayoutEffect(() => {
    if (!anchor) return;
    const target = picker
      ? menuRef.current?.querySelector<HTMLInputElement>("input")
      : menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    target?.focus({ preventScroll: true });
  }, [picker]);

  return (
    <div
      {...props}
      ref={rowRef}
      tabIndex={props.tabIndex ?? 0}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const bounds = event.currentTarget.getBoundingClientRect();
        open(event.clientX || bounds.left + 16, event.clientY || bounds.top + bounds.height / 2);
      }}
      onKeyDown={(event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          event.stopPropagation();
          const bounds = event.currentTarget.getBoundingClientRect();
          open(bounds.left + 16, bounds.top + bounds.height / 2);
        } else onKeyDown?.(event);
      }}
    >
      {children}
      {anchor && createPortal(
        <div
          className="queueMenu songQueueMenu t-dropdown"
          data-picker={picker}
          ref={menuRef}
          role={picker ? "dialog" : "menu"}
          aria-label={picker ? `Add ${songTitle} to playlist` : `Song options for ${songTitle}`}
          style={{ left: anchor.x, top: anchor.y }}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
          onKeyDown={(event) => {
            event.stopPropagation();
            const input = event.target instanceof HTMLInputElement;
            if (event.key === "Escape" || (!picker && event.key === "Tab")) {
              event.preventDefault();
              if (picker) setPicker(false);
              else close(true);
            } else if (picker && event.key === "Tab") {
              const items = Array.from(menuRef.current!.querySelectorAll<HTMLElement>("input, button:not(:disabled)"));
              const current = items.indexOf(document.activeElement as HTMLElement);
              const next = (current + (event.shiftKey ? -1 : 1) + items.length) % items.length;
              event.preventDefault();
              items[next]?.focus();
            } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && !(input && ["Home", "End"].includes(event.key))) {
              event.preventDefault();
              const items = Array.from(menuRef.current!.querySelectorAll<HTMLButtonElement>(picker ? ".songPlaylistOptions button:not(:disabled)" : "button:not(:disabled)"));
              const current = items.indexOf(document.activeElement as HTMLButtonElement);
              const next = event.key === "Home" ? 0 : event.key === "End" || (current < 0 && event.key === "ArrowUp") ? items.length - 1 : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
              items[next]?.focus({ preventScroll: true });
              items[next]?.scrollIntoView({ block: "nearest" });
            }
          }}
        >
          <div className="songQueueMenuTitle" title={songTitle}>{songTitle}</div>
          {!picker ? <>
            <button role="menuitem" type="button" disabled={queueDisabled} onClick={() => { close(true); void onEnqueue([fileId], "up_next"); }}>
              <ListStart aria-hidden="true" /> Play next
            </button>
            <button role="menuitem" type="button" disabled={queueDisabled} onClick={() => { close(true); void onEnqueue([fileId], "end"); }}>
              <ListEnd aria-hidden="true" /> Add to queue
            </button>
            {playlists && <>
              <div className="songMenuDivider" role="separator" />
              <button role="menuitem" type="button" aria-haspopup="dialog" onClick={() => setPicker(true)}>
                <ListMusic aria-hidden="true" /> Add to playlist <ChevronRight className="songMenuTrailing" aria-hidden="true" />
              </button>
            </>}
          </> : <>
            <button className="songPlaylistBack" type="button" onClick={() => setPicker(false)}>
              <ArrowLeft aria-hidden="true" /> Add to playlist
            </button>
            <label className="songPlaylistSearch">
              <Search aria-hidden="true" />
              <input aria-label="Search playlists" placeholder="Find a playlist…" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <div className="songPlaylistOptions" aria-label="Playlists" aria-busy={saving !== null}>
              {matches.map((playlist) => {
                const added = addedIds.includes(playlist.id) || playlist.items.some((item) => item.file.id === fileId);
                return <button key={playlist.id} type="button" disabled={saving !== null || added} onClick={() => void addToPlaylist(playlist)}>
                  {added ? <Check aria-hidden="true" /> : <ListMusic aria-hidden="true" />}
                  <span><strong>{playlist.name}</strong><small>{saving === playlist.id ? "Adding…" : added ? "Already added" : `${playlist.items.length} track${playlist.items.length === 1 ? "" : "s"}`}</small></span>
                </button>;
              })}
              {matches.length === 0 && <p className="songPlaylistEmpty">{playlists?.status === "loading" ? "Loading playlists…" : playlists?.status === "error" ? "Couldn't load playlists." : playlists?.playlists.length ? "No matching playlists." : "No playlists yet. Create one in Lists."}</p>}
            </div>
            {playlists?.status === "error" && <button type="button" onClick={() => void playlists.onRefresh()}>Retry loading playlists</button>}
            {notice && <p className={`songPlaylistNotice${notice.error ? " error" : ""}`} role={notice.error ? "alert" : "status"}>{!notice.error && <Check aria-hidden="true" />}{notice.text}</p>}
          </>}
        </div>,
        rowRef.current?.closest(".appShell") ?? document.body
      )}
    </div>
  );
}
