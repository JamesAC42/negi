import { YoutubeCopyLink } from "./YoutubeCopyLink";
import { X, Clapperboard, ListMusic, Pause, Play, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { youtubePlayback, useYoutubePlayback } from "./youtube-playback";
import "./youtube-now-playing.css";
const time = (ms: number) => { const seconds = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; };

export function YoutubeTransport() {
  const state = useYoutubePlayback();
  return <div className="topTransport youtubeTransport" aria-label="YouTube playback controls">
    <button type="button" aria-label="Previous video" disabled={state.loading} onClick={() => void youtubePlayback.previous()}><SkipBack size={17} /></button>
    <button type="button" className="topPlay" aria-label={state.playing ? "Pause YouTube" : "Resume YouTube"} disabled={(state.loading && !state.playing) || state.videoUnavailable || !state.video} onClick={() => void youtubePlayback.toggle()}>{state.playing ? <Pause size={17} /> : <Play size={17} />}</button>
    <button type="button" className="youtubeSourceBadge" aria-label="Open YouTube player" onClick={() => youtubePlayback.reopen()}><Clapperboard size={17} /><span>YouTube</span></button>
    <button type="button" aria-label="Next video" disabled={state.loading || state.queueIndex >= state.queue.length - 1} onClick={() => void youtubePlayback.next()}><SkipForward size={17} /></button>
    <input className="youtubeTopSeek" aria-label="Seek YouTube playback" type="range" min={0} max={state.durationMs || 1} step={1000} value={Math.min(state.positionMs, state.durationMs || 1)} disabled={!state.durationMs || state.loading} onChange={event => youtubePlayback.seek(Number(event.target.value))} />
    <span className="topTime">{time(state.positionMs)}</span>
    <label className="topVolume"><Volume2 size={17} /><input aria-label="YouTube playback volume" type="range" min={0} max={100} value={state.volumePercent} onChange={event => youtubePlayback.setVolume(Number(event.target.value))} /></label>
  </div>;
}
export function YoutubeNowPlaying() {

  const state = useYoutubePlayback();
  const video = state.video;

  if (!video) return null;
  return <aside className="nowPlayingInspector youtubeNowPlaying" aria-label="YouTube Now Playing">
    <div className="nowPlayingInspectorHeader"><strong>Now Playing · YouTube</strong><button aria-label="Open YouTube player and queue" onClick={() => youtubePlayback.reopen()}><ListMusic size={16} /></button></div>
    <div className="nowPlayingInspectorScroll">
      <button className="nowPlayingInspectorArtworkButton youtubeNowPlayingArtwork" aria-label="Open playing YouTube video" onClick={() => youtubePlayback.reopen()}>{video.thumbnail ? <img src={video.thumbnail} alt={video.title} /> : <Clapperboard size={50} />}</button>
      <div className="nowPlayingInspectorBody">
        <span className="eyebrow">{state.loading ? "Loading video" : state.playing ? "Playing" : "Paused"} · {state.queueIndex + 1} / {state.queue.length}</span>
        <h2>{video.title}</h2><p className="youtubeNowPlayingChannel">{video.channel || "YouTube"}</p>
        {state.error && <p className="youtubePlaybackNotice" role="status">{state.error}</p>}
        <dl className="nowPlayingInspectorMetadata">
          <div><dt>Position</dt><dd>{time(state.positionMs)} / {time(state.durationMs)}</dd></div>
          {video.viewCount != null && <div><dt>Views</dt><dd>{video.viewCount.toLocaleString()}</dd></div>}
          {video.uploadDate && <div><dt>Published</dt><dd>{video.approximateDate ? "≈ " : ""}{video.uploadDate}</dd></div>}
          <div><dt>Video ID</dt><dd>{video.id}</dd></div>
          <div><dt>Up next</dt><dd>{Math.max(0, state.queue.length - state.queueIndex - 1)} videos</dd></div>
        </dl>
        <div className="youtubeNowPlayingLinks"><button onClick={() => youtubePlayback.reopen()}><ListMusic size={17} />View queue</button><YoutubeCopyLink url={video.url} /></div>
        <button className="youtubeRelease" onClick={() => youtubePlayback.release()}><X size={16} />Clear</button>
      </div>
    </div>
  </aside>;
}