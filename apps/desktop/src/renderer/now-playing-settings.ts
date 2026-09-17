import { useEffect, useState } from "react";

export const nowPlayingSettingsKey = "music-os:now-playing:v1";
export type NowPlayingColorMode = "artwork" | "theme" | "custom";
export type NowPlayingSettings = {
  leftMeter: boolean;
  rightMeter: boolean;
  spectrogram: boolean;
  waveform: boolean;
  liveSpectrum: boolean;
  colorMode: NowPlayingColorMode;
  customColor: string;
};
export const defaultNowPlayingSettings: NowPlayingSettings = {
  leftMeter: true, rightMeter: true, spectrogram: true, waveform: true, liveSpectrum: true,
  colorMode: "artwork", customColor: "#c3f53c"
};

export function normalizeNowPlayingSettings(value: unknown): NowPlayingSettings {
  const data = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const toggle = (key: keyof NowPlayingSettings) => typeof data[key] === "boolean"
    ? data[key] as boolean : defaultNowPlayingSettings[key] as boolean;
  return {
    leftMeter: toggle("leftMeter"), rightMeter: toggle("rightMeter"),
    spectrogram: toggle("spectrogram"), waveform: toggle("waveform"), liveSpectrum: toggle("liveSpectrum"),
    colorMode: data.colorMode === "theme" || data.colorMode === "custom" ? data.colorMode : "artwork",
    customColor: typeof data.customColor === "string" && /^#[0-9a-f]{6}$/i.test(data.customColor)
      ? data.customColor.toLowerCase() : defaultNowPlayingSettings.customColor
  };
}

export function loadNowPlayingSettings(storage?: Pick<Storage, "getItem">): NowPlayingSettings {
  try { return normalizeNowPlayingSettings(JSON.parse((storage ?? window.localStorage).getItem(nowPlayingSettingsKey) ?? "null")); }
  catch { return { ...defaultNowPlayingSettings }; }
}

export function useNowPlayingSettings() {
  const [settings, setSettings] = useState(loadNowPlayingSettings);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    try {
      window.localStorage.setItem(nowPlayingSettingsKey, JSON.stringify(settings));
      setSaveError(null);
    } catch {
      setSaveError("Changes apply now, but could not be saved on this device.");
    }
  }, [settings]);
  return { settings, setSettings, saveError };
}
