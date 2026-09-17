import { useEffect, useRef, useState } from "react";

const colorPattern = /^#[0-9a-f]{6}$/i;
const colorCommitDelayMs = 150;

// Native color dialogs emit input for every drag tick. Keep those updates local:
// committing each one rerenders App and synchronously writes its preferences.
export function useColorDraft(value: string, onCommit: (color: string) => void) {
  const [hex, setHex] = useState(value);
  const [color, setColor] = useState(value);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committed = useRef(value);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  function cancelTimer() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }

  function flush() {
    cancelTimer();
    const next = pending.current;
    pending.current = null;
    if (next !== null && next !== committed.current) {
      committed.current = next;
      commitRef.current(next);
    }
  }

  function edit(next: string) {
    cancelTimer();
    setHex(next);
    pending.current = null;
    if (!colorPattern.test(next)) return;
    const normalized = next.toLowerCase();
    setColor(normalized);
    pending.current = normalized;
    timer.current = setTimeout(flush, colorCommitDelayMs);
  }

  useEffect(() => {
    cancelTimer();
    pending.current = null;
    committed.current = value;
    setHex(value);
    setColor(value);
  }, [value]);

  // Preserve the last valid draft when Settings closes or the color mode changes.
  useEffect(() => () => flush(), []);

  return { hex, color, valid: colorPattern.test(hex), edit, flush };
}
