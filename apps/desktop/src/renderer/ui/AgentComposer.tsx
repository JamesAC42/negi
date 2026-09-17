import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { ArrowRight, ArrowUp } from "lucide-react";

export interface AgentComposerHandle { prepare(prompt: string): void }

// Keep keystrokes local. The shared ref retains the draft across page changes
// without making App, conversation results, or the history rail render per key.
export const AgentComposer = forwardRef<AgentComposerHandle, {
  draftRef: { current: string };
  busy: boolean;
  onSubmit(message: string): Promise<void>;
  onOpenOperations(): void;
}>(function AgentComposer({ draftRef, busy, onSubmit, onOpenOperations }, ref) {
  const [draft, setDraft] = useState(() => draftRef.current);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const submissionPending = useRef(false);
  const unavailable = busy || submitting;

  function updateDraft(value: string) {
    draftRef.current = value;
    setDraft(value);
  }

  useImperativeHandle(ref, () => ({
    prepare(prompt) {
      updateDraft(prompt);
      inputRef.current?.focus({ preventScroll: true });
    }
  }));

  async function submit() {
    const message = draftRef.current.trim();
    if (!message || busy || submissionPending.current) return;
    submissionPending.current = true;
    setSubmitting(true);
    updateDraft("");
    try { await onSubmit(message); }
    finally { submissionPending.current = false; setSubmitting(false); }
  }

  return <form className="agentInputArea" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <div className="agentInputBox">
      <textarea rows={1} ref={inputRef} aria-label="Agent message" placeholder="Ask for music, or describe a feeling…"
        value={draft} onChange={event => updateDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
            event.preventDefault();
            if (!unavailable && draftRef.current.trim()) event.currentTarget.form?.requestSubmit();
          }
        }} />
      <button type="submit" aria-label="Send message" disabled={unavailable || !draft.trim()}><ArrowUp size={22}/></button>
    </div>
    <div className="agentInputHint"><span>Your taste informs discovery · You review catalog downloads</span><button type="button" onClick={onOpenOperations}>Operations <ArrowRight size={11}/></button></div>
  </form>;
});
AgentComposer.displayName = "AgentComposer";
