import { type Dispatch, type SetStateAction } from "react";
import { Check, SlidersHorizontal } from "lucide-react";
import type { NowPlayingColorMode, NowPlayingSettings as Preferences } from "../now-playing-settings";
import { StyledSelect } from "./StyledSelect";
import { useColorDraft } from "../use-color-draft";
import "./now-playing-settings.css";

const visualizers = [
  ["leftMeter", "Left meter", "Level of the left audio channel."],
  ["rightMeter", "Right meter", "Level of the right audio channel."],
  ["spectrogram", "Spectrogram", "Frequency history beneath the player."],
  ["waveform", "Waveform", "Track shape above the player and in the seek bar."],
  ["liveSpectrum", "Live spectrum", "The current mix of low and high frequencies."]
] as const;

export function NowPlayingSettings({ settings, setSettings, saveError }: {
  settings: Preferences;
  setSettings: Dispatch<SetStateAction<Preferences>>;
  saveError: string | null;
}) {
  const patch = (change: Partial<Preferences>) => setSettings(current => ({ ...current, ...change }));
  return <section className="nowPlayingSettings" id="settings-now-playing" aria-labelledby="now-playing-settings-title">
    <header className="studioHeading">
      <div><span className="studioEyebrow"><SlidersHorizontal size={14} /> YOUR LISTENING SPACE</span>
        <h2 id="now-playing-settings-title">Now Playing</h2>
        <p>Choose what appears in the expanded player. The layout fills the space as visualizers are hidden.</p>
      </div>
      <span className={saveError ? "studioSaveState error" : "studioSaveState"}>
        {saveError ? "Save unavailable" : <><Check size={13} /> Autosaves on this device</>}
      </span>
    </header>
    {saveError ? <p className="studioError" role="alert">{saveError}</p> : null}
    <fieldset className="nowPlayingSettingsGroup">
      <legend>Visualizers</legend>
      <div className="nowPlayingSettingsToggles">
        {visualizers.map(([key, label, description]) => <label className="nowPlayingSettingsToggle" key={key}>
          <span><strong>{label}</strong><small>{description}</small></span>
          <input type="checkbox" role="switch" aria-label={label} checked={settings[key]}
            onChange={event => patch({ [key]: event.target.checked })} />
        </label>)}
      </div>
      <p className="nowPlayingSettingsHint">Playback controls and seeking stay available with every visualizer turned off.</p>
    </fieldset>
    <fieldset className="nowPlayingSettingsGroup">
      <legend>Player color</legend>
      <div className="nowPlayingSettingsColor">
        <div><label id="now-playing-color-label">Color source</label>
          <p>Follow the album artwork, use your current theme accent, or choose a fixed color.</p></div>
        <StyledSelect<NowPlayingColorMode> ariaLabel="Now Playing color source" value={settings.colorMode}
          options={[{ value: "artwork", label: "Album art · dynamic" }, { value: "theme", label: "Theme color" }, { value: "custom", label: "Custom color" }]}
          onChange={colorMode => patch({ colorMode })} />
      </div>
      {settings.colorMode === "custom" ? <CustomColorControl value={settings.customColor}
        onChange={customColor => patch({ customColor })} /> : null}
    </fieldset>
  </section>;
}

function CustomColorControl({ value, onChange }: { value: string; onChange(color: string): void }) {
  const { hex, color, valid, edit, flush } = useColorDraft(value, onChange);
  return <div className="nowPlayingCustomColor">
    <label><span>Custom color</span><input aria-label="Choose Now Playing custom color" type="color" value={color}
      onChange={event => edit(event.target.value)} onBlur={flush} /></label>
    <label><span>Hex color</span><input aria-label="Now Playing hex color" type="text" value={hex} maxLength={7}
      spellCheck={false} aria-invalid={!valid} aria-describedby={!valid ? "now-playing-color-error" : undefined}
      onChange={event => edit(event.target.value)} onBlur={flush} onKeyDown={event => { if (event.key === "Enter") flush(); }} /></label>
    {!valid ? <small id="now-playing-color-error" role="status">Use a six-digit hex color, such as #c3f53c.</small> : null}
  </div>;
}
