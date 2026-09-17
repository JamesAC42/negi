import { forwardRef, memo, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
export type ArtistListRow = { artist: string; albums: number; tracks: number; letter: string };
export type ArtistListHandle = { scrollToIndex(index: number): void };

/** Window variable-height names without truncating long or translated artist names. */
export const VirtualArtistList = memo(forwardRef<ArtistListHandle, {
  rows: ArtistListRow[]; selected: string | null; empty: string; onSelect(artist: string): void;
}>(function VirtualArtistList({ rows, selected, empty, onSelect }, ref) {
  const viewport = useRef<HTMLDivElement>(null);
  const sizes = useRef(new Map<string, number>());
  const focusTarget = useRef<number | null>(null);
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState({ top: 0, height: 600 });
  const offsets = useMemo(() => {
    const result = [0];
    for (const row of rows) result.push(result[result.length - 1] + (sizes.current.get(row.artist) ?? 48));
    return result;
  }, [rows, revision]);
  const at = (position: number) => {
    let low = 0, high = rows.length;
    while (low < high) { const mid = (low + high) >>> 1; if (offsets[mid + 1] <= position) low = mid + 1; else high = mid; }
    return Math.min(Math.max(0, rows.length - 1), low);
  };
  const start = Math.max(0, at(view.top) - 5);
  const end = Math.min(rows.length, at(view.top + view.height) + 6);
  function scrollToIndex(index: number) {
    const node = viewport.current;
    if (!node || index < 0 || index >= rows.length) return;
    node.scrollTop = offsets[index];
    setView({ top: node.scrollTop, height: node.clientHeight });
  }
  useImperativeHandle(ref, () => ({ scrollToIndex }));
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    // Filtering/sorting resets the viewport; an old scroll offset must not hide results.
    node.scrollTop = 0;
    setView({ top: 0, height: node.clientHeight });
  }, [rows]);
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    let width = node.clientWidth;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth !== width) { width = node.clientWidth; sizes.current.clear(); setRevision(v => v + 1); }
      setView(old => old.height === node.clientHeight ? old : { ...old, height: node.clientHeight });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const observer = new ResizeObserver(entries => {
      let changed = false;
      for (const entry of entries) {
        const name = (entry.target as HTMLElement).dataset.artist!;
        const height = (entry.target as HTMLElement).offsetHeight;
        if (height > 0 && sizes.current.get(name) !== height) { sizes.current.set(name, height); changed = true; }
      }
      if (changed) setRevision(v => v + 1);
    });
    node.querySelectorAll('button[data-artist]').forEach(button => observer.observe(button));
    if (focusTarget.current != null) {
      const target = node.querySelector<HTMLButtonElement>(`button[data-index="${focusTarget.current}"]`);
      if (target) { target.focus({ preventScroll: true }); focusTarget.current = null; }
    }
    return () => observer.disconnect();
  }, [start, end, rows]);
  return <div className="libraryArtistList" ref={viewport} onScroll={event => {
    const node = event.currentTarget;
    setView(old => old.top === node.scrollTop ? old : { top: node.scrollTop, height: node.clientHeight });
  }} onKeyDown={event => {
    const index = Number((event.target as HTMLElement).closest('button')?.dataset.index);
    if (!Number.isFinite(index)) return;
    let next = index;
    if (event.key === 'ArrowDown') next++;
    else if (event.key === 'ArrowUp') next--;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = rows.length - 1;
    else if (event.key === 'PageDown') next += Math.max(1, Math.floor(view.height / 48));
    else if (event.key === 'PageUp') next -= Math.max(1, Math.floor(view.height / 48));
    else return;
    event.preventDefault(); next = Math.max(0, Math.min(rows.length - 1, next));
    focusTarget.current = next;
    const button = viewport.current?.querySelector<HTMLButtonElement>(`button[data-index="${next}"]`);
    if (button) { button.focus(); focusTarget.current = null; }
    else scrollToIndex(next);
  }}>
    {!rows.length ? <div className="libraryPaneEmpty">{empty}</div> : null}
    <div aria-hidden="true" style={{ height: offsets[start], flexShrink: 0 }} />
    {rows.slice(start, end).map((row, offset) => <button key={row.artist} type="button"
      className={row.artist === selected ? 'active' : ''} data-start-letter={row.letter}
      data-artist={row.artist} data-index={start + offset} onClick={() => onSelect(row.artist)}>
      <strong>{row.artist}</strong><span>{row.albums} album{row.albums === 1 ? '' : 's'} - {row.tracks} track{row.tracks === 1 ? '' : 's'}</span>
    </button>)}
    <div aria-hidden="true" style={{ height: offsets[rows.length] - offsets[end], flexShrink: 0 }} />
  </div>;
}));
