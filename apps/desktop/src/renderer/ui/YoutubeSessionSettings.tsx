import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, LogOut, Upload } from "lucide-react";
import { exploreApi as api, errorMessage } from "./explore-api";
import "./youtube-session.css";

export function YoutubeSessionSettings() {
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const abort = new AbortController();
    void api<{configured:boolean}>("/explore/youtube/session", undefined, abort.signal).then(result => setConfigured(result.configured)).catch(e => { if (!abort.signal.aborted) setError(errorMessage(e)); });
    return () => abort.abort();
  }, []);
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (file.size > 1024 * 1024) throw new Error("Choose a cookies.txt file smaller than 1 MB.");
      const result = await api<{configured:boolean}>("/explore/youtube/session", { cookies: await file.text() });
      setConfigured(result.configured); setNotice("YouTube session saved. Retry the video to use it.");
      window.dispatchEvent(new Event("youtube-session-changed"));
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  async function remove() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("http://127.0.0.1:47831/explore/youtube/session", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not remove the YouTube session. Try again.");
      setConfigured(false); setNotice("Saved YouTube session removed.");
      window.dispatchEvent(new Event("youtube-session-changed"));
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <section className="settingsPanel youtubeSessionSettings" id="settings-youtube" aria-label="YouTube playback settings">
    <div><strong>YouTube playback</strong><span>Play videos directly in Music OS, including in the background.</span></div>
    <p>Optional: choose a Netscape <code>cookies.txt</code> export from your signed-in YouTube session for videos that require authentication. It stays on this computer and is used only for YouTube playback. Cookies cannot unlock every unavailable video.</p>
    <div className="youtubeSessionActions">
      <input ref={input} type="file" accept=".txt,text/plain" aria-label="YouTube cookies file" disabled={busy} onChange={e => void upload(e.target.files?.[0])} />
      <button disabled={busy} onClick={() => input.current?.click()}>{busy ? <LoaderCircle className="youtubeSpinner" size={15} /> : <Upload size={15} />}{configured ? "Replace cookies file" : "Choose cookies file"}</button>
      {configured && <><span><Check size={14} /> Session saved</span><button disabled={busy} onClick={() => void remove()}><LogOut size={14} />Remove session</button></>}
    </div>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="exploreError">{error}</p>}
  </section>;
}