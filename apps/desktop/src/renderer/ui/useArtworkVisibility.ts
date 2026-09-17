import { useEffect, useState } from "react";

/** Keep queued image work near the viewport; scrolling away cancels unused loads. */
export function useArtworkVisibility(eager = false) {
  const [element, ref] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(eager);
  useEffect(() => {
    if (eager || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    if (!element) return;
    const observer = new IntersectionObserver(entries => {
      setVisible(entries.some(entry => entry.isIntersecting));
    }, { rootMargin: "200px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, eager]);
  return { ref, visible: eager || visible };
}
