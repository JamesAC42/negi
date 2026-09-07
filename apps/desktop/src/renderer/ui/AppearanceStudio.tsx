import { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { Check, ImagePlus, Moon, Palette, Sun, Trash2, Type } from "lucide-react";
import {
  accentPalettes, appearanceModes, applyAppearanceLook, applyThemePreset, backgroundName,
  curatedThemePresets, displayFonts, getProfileStyle, saveAppearanceLook, themePresetIds, updateProfile,
  type AccentColorId, type AppearanceMode, type AppearanceProfile, type AppearanceSettings, type DisplayFontId
} from "../appearance";
import { StyledSelect } from "./StyledSelect";
import "./appearance-studio.css";

type Props = {
  appearance: AppearanceSettings;
  setAppearance(update: AppearanceSettings | ((current: AppearanceSettings) => AppearanceSettings)): void;
  onSelectBackgroundImage(mode: AppearanceMode): Promise<void>;
  saveError?: string | null;
};

export function AppearanceStudio({ appearance, setAppearance, onSelectBackgroundImage, saveError }: Props): ReactElement {
  const { mode, profiles } = appearance;
  const profile = profiles[mode];
  const [lookName, setLookName] = useState("");
  const [message, setMessage] = useState("");
  const [imageError, setImageError] = useState("");
  const [choosing, setChoosing] = useState<AppearanceMode | null>(null);
  const [fontSearch, setFontSearch] = useState("");
  const style = getProfileStyle(profile, mode) as Record<string, string>;
  const patch = (change: Partial<AppearanceProfile>, target = mode) => setAppearance((current) => updateProfile(current, target, change));
  const modeLabel = mode === "dark" ? "Dark" : "Light";
  const label = profile.themePreset === "custom" ? "Custom" : curatedThemePresets[profile.themePreset].label;
  const fontOptions = Object.entries(displayFonts) as [DisplayFontId, (typeof displayFonts)[DisplayFontId]][];

  async function chooseImage(target: AppearanceMode): Promise<void> {
    setChoosing(target); setImageError("");
    try { await onSelectBackgroundImage(target); }
    catch (error) { setImageError(error instanceof Error ? error.message : "Could not open the image. Please try again."); }
    finally { setChoosing(null); }
  }

  return (
    <section className="appearanceStudio" id="settings-appearance" aria-label="Appearance preferences">
      <header className="studioHeading">
        <div><span className="studioEyebrow"><Palette size={14} /> YOUR SPACE, YOUR SOUND</span><h2>Appearance studio</h2><p>Build a different atmosphere for day and night. Every change stays with its mode.</p></div>
        <span className={saveError ? "studioSaveState error" : "studioSaveState"}>{saveError ? "Save unavailable" : <><Check size={13} /> Autosaves on this device</>}</span>
      </header>
      {saveError ? <p className="studioError" role="alert">{saveError}</p> : null}
      <div className="studioModeGrid" aria-label="Saved light and dark profiles">
        {appearanceModes.map((target) => {
          const p = profiles[target];
          const name = p.themePreset === "custom" ? "Custom" : curatedThemePresets[p.themePreset].label;
          return <button type="button" className={`studioModeCard ${mode === target ? "selected" : ""}`} key={target}
            aria-pressed={mode === target} aria-label={`Switch to ${target} profile`}
            onClick={() => setAppearance((current) => ({ ...current, mode: target }))}>
            <MiniPreview profile={p} mode={target} />
            <span className="studioModeCopy"><span>{target === "dark" ? <Moon size={17} /> : <Sun size={17} />}<strong>{target === "dark" ? "After dark" : "In the light"}</strong>{mode === target ? <Check size={15} /> : null}</span>
              <small>{name} · {displayFonts[p.displayFont].label}</small></span>
          </button>;
        })}
      </div>
      <div className="studioEditing"><span className="studioDot" /><strong>Editing {modeLabel.toLowerCase()} mode</strong><span>Your {mode === "dark" ? "light" : "dark"} setup is saved separately.</span></div>

      <section className="studioSection" aria-labelledby="studio-presets">
        <SectionHeading number="01" title="Find your atmosphere" id="studio-presets" description={`${modeLabel} palettes with coordinated surfaces, typography, and accents. Your wallpaper stays in place.`} />
        <div className="studioPresetGrid">
          {themePresetIds.filter((id) => id === "custom" || curatedThemePresets[id].mode === mode).map((id) => {
            const preset = id === "custom" ? null : curatedThemePresets[id];
            const demo = applyThemePreset(appearance, mode, id).profiles[mode];
            return <button type="button" key={id} className={`studioPresetCard ${profile.themePreset === id ? "selected" : ""}`}
              aria-pressed={profile.themePreset === id} onClick={() => setAppearance((current) => applyThemePreset(current, mode, id))}>
              <MiniPreview profile={{ ...demo, background: null }} mode={mode} />
              <span className="studioPresetName"><strong>{preset?.label ?? "Custom"}</strong>{profile.themePreset === id ? <Check size={14} /> : null}</span>
              <small>{preset?.description ?? "The original workbench palette. Make it your own."}</small>
            </button>;
          })}
        </div>
      </section>

      <section className="studioSection" aria-labelledby="studio-type">
        <SectionHeading number="02" title="Give it a voice" id="studio-type" description="Try a font pairing, then choose a different reading font if you like. Your surface palette stays intact." />
        <div className="studioToolbar"><span><Type size={16} /> {fontOptions.length} font pairings</span><input type="search" aria-label="Find a font" placeholder="Find a font…" value={fontSearch} onChange={(e) => setFontSearch(e.target.value)} /></div>
        <div className="studioFontGrid">
          {fontOptions.filter(([, font]) => font.label.toLowerCase().includes(fontSearch.toLowerCase())).map(([id, font]) =>
            <button key={id} type="button" className={`studioFontCard ${profile.displayFont === id ? "selected" : ""}`} aria-pressed={profile.displayFont === id}
              onClick={() => patch({ displayFont: id, bodyFont: null })}>
              <span className="studioFontSample" style={{ fontFamily: font.head }}>negi. Aa</span>
              <span className="studioFontLabel">{font.label}{profile.displayFont === id ? <Check size={14} /> : null}</span>
              <small style={{ fontFamily: font.body }}>A record for every mood. 012345</small>
            </button>)}
        </div>
        {fontOptions.every(([, font]) => !font.label.toLowerCase().includes(fontSearch.toLowerCase())) ? <p className="studioHint">No fonts match. Clear the search to see all pairings.</p> : null}
        <div className="studioControlGrid">
          <label><span>Reading & interface font</span><StyledSelect<DisplayFontId | "pairing"> ariaLabel="Reading and interface font" value={profile.bodyFont ?? "pairing"}
            options={[{ value: "pairing", label: "Use the selected pairing" }, ...fontOptions.filter(([id]) => id !== "space").map(([id, font]) => ({ value: id, label: id === "avant" ? "Syne" : id === "editorial" ? "Fraunces" : id === "wide" ? "Arial Black" : font.label.split(" + ")[0] }))]}
            onChange={(value) => patch({ bodyFont: value === "pairing" ? null : value })} /></label>
          <label><span>Corner style</span><StyledSelect<AppearanceProfile["corners"]> ariaLabel="Corner style" value={profile.corners}
            options={[{ value: "theme", label: "Follow the preset" }, { value: "square", label: "Square · precise" }, { value: "soft", label: "Soft · balanced" }, { value: "round", label: "Rounded · relaxed" }]}
            onChange={(corners) => patch({ corners })} /></label>
        </div>
      </section>

      <section className="studioSection" aria-labelledby="studio-accent">
        <SectionHeading number="03" title="Choose your signal" id="studio-accent" description="Use a familiar highlight or mix your own. Buttons get a contrasting text color automatically." />
        <div className="studioAccentRow">
          <button type="button" className={`studioPaletteDefault ${!profile.accentOverride && !profile.customAccent ? "selected" : ""}`} aria-pressed={!profile.accentOverride && !profile.customAccent} onClick={() => patch({ accentOverride: false, customAccent: null })}>Preset accent</button>
          {(Object.entries(accentPalettes) as [AccentColorId, (typeof accentPalettes)[AccentColorId]][]).map(([id, palette]) =>
            <button type="button" key={id} className={`studioSwatch ${profile.accentOverride && !profile.customAccent && profile.accent === id ? "selected" : ""}`}
              style={{ "--swatch": palette[mode].acc } as CSSProperties} aria-label={`Use ${palette.label} highlight`} aria-pressed={profile.accentOverride && !profile.customAccent && profile.accent === id}
              onClick={() => patch({ accent: id, accentOverride: true, customAccent: null })}><i /><span>{palette.label}</span></button>)}
        </div>
        <ColorControl value={style["--acc"]} onChange={(customAccent) => patch({ customAccent, accentOverride: true })} />
      </section>

      <section className="studioSection" aria-labelledby="studio-background">
        <SectionHeading number="04" title="Set the scene" id="studio-background" description="Choose a different image for each mode. Click a preview to browse, or reuse a recent image below." />
        {imageError ? <p className="studioError" role="alert">{imageError}</p> : null}
        <div className="studioWallpaperGrid">
          {appearanceModes.map((target) => {
            const bg = profiles[target].background;
            return <article className={`studioWallpaperCard ${mode === target ? "selected" : ""}`} key={target}>
              <button className="studioWallpaperBrowse" type="button" disabled={choosing !== null} onClick={() => void chooseImage(target)} aria-label={`Choose ${target} background image`}>
                {bg ? <ImagePreview key={bg.url} url={bg.url} name={backgroundName(bg.path)} /> : <span className="studioWallpaperEmpty"><ImagePlus size={28} /><strong>Add a {target} background</strong><small>JPG, PNG, WebP, GIF or AVIF</small></span>}
                {bg ? <span className="studioWallpaperOverlay"><ImagePlus size={15} /> Change image</span> : null}
              </button>
              <div className="studioWallpaperInfo"><span>{target === "dark" ? <Moon size={15} /> : <Sun size={15} />}<strong>{target === "dark" ? "Dark mode" : "Light mode"}</strong></span>
                <small title={bg?.path}>{bg ? backgroundName(bg.path) : "No image selected"}</small></div>
              <div className="studioWallpaperActions"><button type="button" disabled={choosing !== null} onClick={() => void chooseImage(target)}>{choosing === target ? "Opening…" : bg ? "Replace image" : "Choose image"}</button>
                <button type="button" disabled={!bg} onClick={() => patch({ background: null }, target)}>Clear</button></div>
            </article>;
          })}
        </div>
        <div className="studioWallpaperTuning">
          <div><strong>{modeLabel} image treatment</strong><small>Saved with your {mode} profile. The preview shows how the image sits behind the interface.</small></div>
          <div className="studioControlGrid">
            <label><span>Image strength <output>{Math.round(Number(style["--app-bg-opacity"]) * 100)}%</output></span><input aria-label="Background image strength" type="range" min="0" max="100" value={Math.round(Number(style["--app-bg-opacity"]) * 100)} onChange={(e) => patch({ backgroundOpacity: Number(e.target.value) / 100 })} /></label>
            <label><span>Soft focus <output>{profile.backgroundBlur}px</output></span><input aria-label="Background blur" type="range" min="0" max="24" value={profile.backgroundBlur} onChange={(e) => patch({ backgroundBlur: Number(e.target.value) })} /></label>
            <label><span>Image framing</span><StyledSelect<AppearanceProfile["backgroundFit"]> ariaLabel="Background fit" value={profile.backgroundFit} options={[{ value: "cover", label: "Fill the space" }, { value: "contain", label: "Show the whole image" }]} onChange={(backgroundFit) => patch({ backgroundFit })} /></label>
            <label><span>Focal point</span><StyledSelect<AppearanceProfile["backgroundPosition"]> ariaLabel="Background focal point" value={profile.backgroundPosition} options={[{ value: "center", label: "Center" }, { value: "top", label: "Top" }, { value: "bottom", label: "Bottom" }]} onChange={(backgroundPosition) => patch({ backgroundPosition })} /></label>
          </div>
          <MiniPreview profile={profile} mode={mode} large />
        </div>
        {appearance.backgroundImages.length > 0 ? <><div className="studioRecentHeading"><strong>Recently chosen</strong><span>Reuse an image in either mode. Removing it here keeps your current backgrounds.</span></div>
          <div className="studioRecentGrid">{appearance.backgroundImages.map((image) => <article className="studioRecentCard" key={image.id}>
            <div className="studioRecentImage"><ImagePreview key={image.url} url={image.url} name={image.name} /></div>
            <strong title={image.path}>{image.name}</strong>
            <div>{appearanceModes.map((target) => <button type="button" key={target} aria-label={`Use ${image.name} for ${target} mode`} aria-pressed={profiles[target].background?.path === image.path} onClick={() => patch({ background: { path: image.path, url: image.url } }, target)}>{profiles[target].background?.path === image.path ? <Check size={12} /> : target === "dark" ? <Moon size={12} /> : <Sun size={12} />}{target}</button>)}
              <button className="studioRemove" type="button" aria-label={`Remove ${image.name} from recent images`} title="Remove from recent images" onClick={() => setAppearance((current) => ({ ...current, backgroundImages: current.backgroundImages.filter((item) => item.id !== image.id) }))}><Trash2 size={13} /></button></div>
          </article>)}</div></> : null}
      </section>

      <section className="studioSection" aria-labelledby="studio-looks">
        <SectionHeading number="05" title="Keep your favorites" id="studio-looks" description="Save this combination of palette, fonts, accent, and wallpaper. Restore a favorite in one click." />
        <form className="studioSaveLook" onSubmit={(e) => { e.preventDefault(); if (!lookName.trim()) return; setAppearance((current) => saveAppearanceLook(current, lookName)); setMessage(`Saved “${lookName.trim()}” for ${mode} mode.`); setLookName(""); }}>
          <label><span>Name this {mode} look</span><input aria-label="Saved look name" maxLength={60} value={lookName} placeholder={`${label} · my mix`} onChange={(e) => setLookName(e.target.value)} /></label><button type="submit" disabled={!lookName.trim()}>Save current look</button>
        </form>
        <p className="studioHint" role="status">{message || `${modeLabel} mode is saved automatically. Named looks let you keep more than one favorite.`}</p>
        {appearance.savedLooks.length ? <div className="studioLookGrid">{appearance.savedLooks.map((look) => <article className="studioLookCard" key={look.id}>
          <button type="button" aria-label={`Apply ${look.name}`} onClick={() => { setAppearance((current) => applyAppearanceLook(current, look)); setMessage(`Applied “${look.name}” to ${look.mode} mode.`); }}>
            <MiniPreview profile={look.profile} mode={look.mode} /><strong>{look.name}</strong><small>{look.mode === "dark" ? "Dark" : "Light"} mode · {displayFonts[look.profile.displayFont].label}</small>
          </button><button type="button" className="studioRemove" aria-label={`Remove saved look ${look.name}`} title="Remove saved look" onClick={() => setAppearance((current) => ({ ...current, savedLooks: current.savedLooks.filter((item) => item.id !== look.id) }))}><Trash2 size={14} /></button>
        </article>)}</div> : null}
      </section>
    </section>
  );
}

function SectionHeading({ number, title, description, id }: { number: string; title: string; description: string; id: string }): ReactElement {
  return <header className="studioSectionHeading"><span>{number}</span><div><h3 id={id}>{title}</h3><p>{description}</p></div></header>;
}

function MiniPreview({ profile, mode, large = false }: { profile: AppearanceProfile; mode: AppearanceMode; large?: boolean }): ReactElement {
  return <span className={`studioMiniPreview ${large ? "large" : ""}`} style={getProfileStyle(profile, mode)} aria-hidden="true">
    <span className="studioMiniWallpaper" /><span className="studioMiniTop"><span>negi</span><i /><i /><b /></span>
    <span className="studioMiniBody"><span className="studioMiniArt"><i /><i /></span><span className="studioMiniTracks"><strong>{large ? "Your next favorite record." : "On repeat."}</strong><span>Made for the way you listen.</span><i /><i /><i /><b /></span></span>
  </span>;
}

function ImagePreview({ url, name }: { url: string; name: string }): ReactElement {
  const [failed, setFailed] = useState(false);
  return failed ? <span className="studioImageMissing"><ImagePlus size={24} /><strong>Image unavailable</strong><small>Choose it again if it moved.</small></span>
    : <img src={url} alt={name} loading="lazy" onError={() => setFailed(true)} />;
}

function ColorControl({ value, onChange }: { value: string; onChange(value: string): void }): ReactElement {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  const valid = /^#[0-9a-f]{6}$/i.test(hex);
  return <div className="studioCustomColor"><label><span>Custom highlight</span><input type="color" aria-label="Custom highlight color" value={value} onChange={(e) => onChange(e.target.value)} /></label>
    <label><span>Hex color</span><input type="text" aria-label="Custom highlight hex" value={hex} maxLength={7} spellCheck={false} aria-invalid={!valid} onChange={(e) => { setHex(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value); }} /></label>
    {!valid ? <small>Use a six-digit color, such as #62d7f4.</small> : <small>Applies to {" "}<span className="studioAccentExample">buttons, signals & your onion icon</span>.</small>}
  </div>;
}
