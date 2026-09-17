import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

export function YoutubeCopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { setCopied(false); setFailed(false); return () => clearTimeout(timer.current); }, [url]);
  return <button className="youtubeCopyLink" aria-label={copied ? "Link copied" : "Copy link"} title={failed ? "Could not copy. Try again." : copied ? "Link copied" : "Copy link"} onClick={async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setFailed(false); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 2200); }
    catch { setFailed(true); }
  }}>{copied ? <Check size={16} /> : <Copy size={16} />}<span>Copy link</span>{failed && <span role="status">Try again</span>}</button>;
}