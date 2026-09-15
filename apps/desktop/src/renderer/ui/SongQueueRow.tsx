import { useLayoutEffect, useRef, useState, type HTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { ListEnd, ListStart } from "lucide-react";
type QueueInsertPosition = "up_next" | "end";
import "./song-queue-menu.css";

type Props = HTMLAttributes<HTMLDivElement> & {
  fileId: string;
  songTitle: string;
  queueDisabled: boolean;
  onEnqueue(fileIds: string[], position: QueueInsertPosition): Promise<void>;
};

/** Preserves each song row's layout while sharing queue actions and accessibility. */
export function SongQueueRow({ fileId, songTitle, queueDisabled, onEnqueue, children, onKeyDown, ...props }: Props) {
  const rowRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  function close(restoreFocus = false) {
    setAnchor(null);
    if (restoreFocus) (returnFocusRef.current?.isConnected ? returnFocusRef.current : rowRef.current)?.focus({ preventScroll: true });
  }

  function open(x: number, y: number) {
    returnFocusRef.current = document.activeElement instanceof HTMLElement && rowRef.current?.contains(document.activeElement)
      ? document.activeElement : rowRef.current;
    setAnchor({ x, y });
  }

  useLayoutEffect(() => {
    if (!anchor) return;
    const menu = menuRef.current!;
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(anchor.x, window.innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(anchor.y, window.innerHeight - bounds.height - 8))}px`;
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    const dismiss = () => close();
    const outside = (event: Event) => {
      if (!menu.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("contextmenu", outside);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("contextmenu", outside);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("blur", dismiss);
    };
  }, [anchor]);

  return (
    <div
      {...props}
      ref={rowRef}
      tabIndex={props.tabIndex ?? 0}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (queueDisabled) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        open(event.clientX || bounds.left + 16, event.clientY || bounds.top + bounds.height / 2);
      }}
      onKeyDown={(event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          event.stopPropagation();
          if (!queueDisabled) {
            const bounds = event.currentTarget.getBoundingClientRect();
            open(bounds.left + 16, bounds.top + bounds.height / 2);
          }
        } else onKeyDown?.(event);
      }}
    >
      {children}
      {anchor && createPortal(
        <div
          className="queueMenu songQueueMenu"
          ref={menuRef}
          role="menu"
          aria-label={`Queue options for ${songTitle}`}
          style={{ left: anchor.x, top: anchor.y }}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape" || event.key === "Tab") {
              event.preventDefault();
              close(true);
            } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const items = Array.from(menuRef.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
              const current = items.indexOf(document.activeElement as HTMLButtonElement);
              const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
              items[next]?.focus({ preventScroll: true });
            }
          }}
        >
          <div className="songQueueMenuTitle" title={songTitle}>{songTitle}</div>
          <button role="menuitem" type="button" disabled={queueDisabled} onClick={() => { close(true); void onEnqueue([fileId], "up_next"); }}>
            <ListStart aria-hidden="true" /> Play next
          </button>
          <button role="menuitem" type="button" disabled={queueDisabled} onClick={() => { close(true); void onEnqueue([fileId], "end"); }}>
            <ListEnd aria-hidden="true" /> Add to queue
          </button>
        </div>,
        rowRef.current?.closest(".appShell") ?? document.body
      )}
    </div>
  );
}
