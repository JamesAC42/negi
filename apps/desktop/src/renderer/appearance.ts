import type { CSSProperties } from "react";

export type AppearanceMode = "dark" | "light";
export type ThemePresetId = "custom" | "nocturne" | "newsprint" | "crt" | "blueprint" | "forest" | "carbon" | "sakura" | "lagoon" | "espresso" | "synthwave" | "porcelain" | "linen" | "matcha" | "lavender" | "arctic" | "peach";
export type CuratedThemePresetId = Exclude<ThemePresetId, "custom">;
export type AccentColorId = "lime" | "code" | "cyan" | "amber" | "rose" | "violet";
export type DisplayFontId = "space" | "grotesk" | "mono" | "system" | "wide" | "editorial" | "avant" | "inter" | "manrope" | "outfit" | "dm" | "lora" | "slab";
export type SelectedBackgroundImage = { path: string; url: string };
export type SavedBackgroundImage = { id: string; name: string; path: string; url: string; addedAt: string };
export type AppearanceBackgrounds = Record<AppearanceMode, SelectedBackgroundImage | null>;
export type AppearanceProfile = {
  themePreset: ThemePresetId;
  accent: AccentColorId;
  accentOverride: boolean;
  customAccent: string | null;
  displayFont: DisplayFontId;
  bodyFont: DisplayFontId | null;
  background: SelectedBackgroundImage | null;
  backgroundOpacity: number | null;
  backgroundBlur: number;
  backgroundPosition: "center" | "top" | "bottom";
  backgroundFit: "cover" | "contain";
  corners: "theme" | "square" | "soft" | "round";
};
export type SavedAppearanceLook = { id: string; name: string; mode: AppearanceMode; profile: AppearanceProfile };
export type AppearanceSettings = {
  version: 2;
  mode: AppearanceMode;
  profiles: Record<AppearanceMode, AppearanceProfile>;
  backgroundImages: SavedBackgroundImage[];
  savedLooks: SavedAppearanceLook[];
};
export const appearanceStorageKey = "music-os:appearance:v2";
export const legacyAppearanceStorageKey = "music-os:appearance:v1";

export const appearanceModes: AppearanceMode[] = ["dark", "light"];
export const accentPalettes: Record<AccentColorId, { label: string; dark: AccentPalette; light: AccentPalette }> = {
  lime: {
    label: "Lime",
    dark: { acc: "#c3f53c", accDim: "rgba(195, 245, 60, 0.12)", accInk: "#10130a", accLine: "rgba(195, 245, 60, 0.38)", okLine: "#4c5f2c" },
    light: { acc: "#6e9f00", accDim: "rgba(110, 159, 0, 0.14)", accInk: "#f8fbf0", accLine: "rgba(110, 159, 0, 0.36)", okLine: "#b8cc86" }
  },
  code: {
    label: "Code",
    dark: { acc: "#32e875", accDim: "rgba(50, 232, 117, 0.13)", accInk: "#03130a", accLine: "rgba(50, 232, 117, 0.42)", okLine: "#1d653c" },
    light: { acc: "#087a3f", accDim: "rgba(8, 122, 63, 0.13)", accInk: "#f2fff7", accLine: "rgba(8, 122, 63, 0.34)", okLine: "#8fcaa7" }
  },
  cyan: {
    label: "Cyan",
    dark: { acc: "#62d7f4", accDim: "rgba(98, 215, 244, 0.13)", accInk: "#061014", accLine: "rgba(98, 215, 244, 0.4)", okLine: "#2d5965" },
    light: { acc: "#007b95", accDim: "rgba(0, 123, 149, 0.13)", accInk: "#effcff", accLine: "rgba(0, 123, 149, 0.34)", okLine: "#8fc3cf" }
  },
  amber: {
    label: "Amber",
    dark: { acc: "#f2b84b", accDim: "rgba(242, 184, 75, 0.14)", accInk: "#160f04", accLine: "rgba(242, 184, 75, 0.38)", okLine: "#6b5528" },
    light: { acc: "#a86600", accDim: "rgba(168, 102, 0, 0.13)", accInk: "#fff8ec", accLine: "rgba(168, 102, 0, 0.34)", okLine: "#d8b983" }
  },
  rose: {
    label: "Rose",
    dark: { acc: "#ff7aa7", accDim: "rgba(255, 122, 167, 0.13)", accInk: "#17070d", accLine: "rgba(255, 122, 167, 0.38)", okLine: "#6a3348" },
    light: { acc: "#b83d68", accDim: "rgba(184, 61, 104, 0.12)", accInk: "#fff3f7", accLine: "rgba(184, 61, 104, 0.34)", okLine: "#dda0b5" }
  },
  violet: {
    label: "Violet",
    dark: { acc: "#a994ff", accDim: "rgba(169, 148, 255, 0.13)", accInk: "#0d091d", accLine: "rgba(169, 148, 255, 0.38)", okLine: "#514778" },
    light: { acc: "#6954bb", accDim: "rgba(105, 84, 187, 0.12)", accInk: "#f7f4ff", accLine: "rgba(105, 84, 187, 0.34)", okLine: "#b1a8db" }
  }
};
export const displayFonts: Record<DisplayFontId, { label: string; head: string; body: string }> = {
  space: {
    label: "Workbench - Space Grotesk + JetBrains Mono",
    head: "\"Space Grotesk Variable\", \"Space Grotesk\", sans-serif",
    body: "\"JetBrains Mono Variable\", \"JetBrains Mono\", ui-monospace, monospace"
  },
  grotesk: {
    label: "Space Grotesk",
    head: "\"Space Grotesk Variable\", \"Space Grotesk\", sans-serif",
    body: "\"Space Grotesk Variable\", \"Space Grotesk\", sans-serif"
  },
  mono: {
    label: "JetBrains Mono",
    head: "\"JetBrains Mono Variable\", \"JetBrains Mono\", ui-monospace, monospace",
    body: "\"JetBrains Mono Variable\", \"JetBrains Mono\", ui-monospace, monospace"
  },
  system: {
    label: "System Sans",
    head: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
    body: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
  },
  editorial: {
    label: "Editorial - Fraunces Serif",
    head: "\"Fraunces Variable\", Fraunces, Georgia, serif",
    body: "\"Fraunces Variable\", Fraunces, Georgia, serif"
  },
  avant: {
    label: "Avant-garde - Syne + Space Grotesk",
    head: "\"Syne Variable\", Syne, \"Space Grotesk Variable\", sans-serif",
    body: "\"Space Grotesk Variable\", \"Space Grotesk\", sans-serif"
  },
  inter: { label: "Inter", head: '"Inter Variable", sans-serif', body: '"Inter Variable", sans-serif' },
  manrope: { label: "Manrope", head: '"Manrope Variable", sans-serif', body: '"Manrope Variable", sans-serif' },
  outfit: { label: "Outfit + Inter", head: '"Outfit Variable", sans-serif', body: '"Inter Variable", sans-serif' },
  dm: { label: "DM Sans", head: '"DM Sans Variable", sans-serif', body: '"DM Sans Variable", sans-serif' },
  lora: { label: "Lora + Inter", head: '"Lora Variable", serif', body: '"Inter Variable", sans-serif' },
  slab: { label: "Roboto Slab + DM Sans", head: '"Roboto Slab Variable", serif', body: '"DM Sans Variable", sans-serif' },
  wide: {
    label: "Wide headings",
    head: "\"Arial Black\", \"Arial\", ui-sans-serif, system-ui, sans-serif",
    body: "\"JetBrains Mono Variable\", \"JetBrains Mono\", ui-monospace, monospace"
  }
};

export type AccentPalette = { acc: string; accDim: string; accInk: string; accLine: string; okLine: string };
export type CuratedThemePreset = {
  label: string;
  description: string;
  mode: AppearanceMode;
  accent: AccentColorId;
  accentPalette: AccentPalette;
  displayFont: DisplayFontId;
  preview: { background: string; surface: string; accent: string; text: string };
  variables: Record<string, string>;
};

export const curatedThemePresets: Record<CuratedThemePresetId, CuratedThemePreset> = {
  forest: makeTheme("Forest", "Moss, pine, and a little late-night quiet.", "dark", "code", "manrope", ["#0b1511", "#111f19", "#192c23", "#293e32", "#e7f2e8", "#b5ccbc", "#839f8d", "#8bd5a5"]),
  carbon: makeTheme("Carbon", "Graphite surfaces and precise, neutral type.", "dark", "cyan", "inter", ["#101113", "#191b1e", "#23262a", "#34383e", "#f1f3f5", "#bec4cc", "#929ba8", "#a9c8ff"]),
  sakura: makeTheme("Sakura", "Ink-black plum with a blush of pink.", "dark", "rose", "lora", ["#1b111b", "#271927", "#352435", "#483247", "#f9eaf4", "#d9bcd0", "#b18ea5", "#f3a3c5"]),
  lagoon: makeTheme("Lagoon", "Deep teal, luminous water, and open shapes.", "dark", "cyan", "outfit", ["#071c20", "#10282e", "#19373e", "#28505a", "#e3f5f6", "#a9d0d5", "#7aaab3", "#65dfd0"]),
  espresso: makeTheme("Espresso", "Roasted browns, copper, and warm slab type.", "dark", "amber", "slab", ["#19130f", "#261e17", "#35291f", "#49392b", "#f5e8d6", "#d3baa0", "#ac9278", "#eeb777"]),
  synthwave: makeTheme("Synthwave", "Midnight violet with electric pink signals.", "dark", "rose", "avant", ["#120d25", "#1e1539", "#2b204d", "#413264", "#f5edff", "#cdbcdf", "#a28abb", "#ff8cdb"]),
  porcelain: makeTheme("Porcelain", "Clean white, cobalt details, and quiet clarity.", "light", "cyan", "inter", ["#f4f6fa", "#ffffff", "#eaf0f8", "#d5dfed", "#18243b", "#405471", "#677a95", "#2455bd"]),
  linen: makeTheme("Linen", "Oatmeal paper and a relaxed literary rhythm.", "light", "amber", "lora", ["#f3ede2", "#fcf8f0", "#eae1d1", "#d7cbb6", "#322c23", "#615443", "#80715e", "#95601c"]),
  matcha: makeTheme("Matcha", "Fresh sage, soft light, and grounded greens.", "light", "code", "manrope", ["#edf2e8", "#f8fbf3", "#e0e9d9", "#c7d7bd", "#203423", "#49604a", "#687e67", "#347247"]),
  lavender: makeTheme("Lavender", "Pale lilac with ink-purple accents.", "light", "violet", "dm", ["#f0edf8", "#faf8ff", "#e7e0f3", "#d3c8e5", "#312646", "#5c4b73", "#7c6b92", "#7546ad"]),
  arctic: makeTheme("Arctic", "Glacier blue and the precision of a field note.", "light", "cyan", "space", ["#eaf3f6", "#f6fcff", "#dceaf0", "#c1d6e0", "#183543", "#3e5e6d", "#64808e", "#126b87"]),
  peach: makeTheme("Peach", "Sun-warmed cream with terracotta details.", "light", "rose", "outfit", ["#fbefe6", "#fff9f2", "#f4e1d1", "#e4c8b3", "#492e24", "#785444", "#946f5b", "#b04930"]),
  nocturne: {
    label: "Nocturne",
    description: "Velvet ink, ultraviolet signals, and sculptural Syne headings.",
    mode: "dark",
    accent: "violet",
    accentPalette: {
      acc: "#b89cff",
      accDim: "rgba(184, 156, 255, 0.15)",
      accInk: "#130a24",
      accLine: "rgba(184, 156, 255, 0.46)",
      okLine: "#5f4b88"
    },
    displayFont: "avant",
    preview: { background: "#0b0914", surface: "#241f3a", accent: "#b89cff", text: "#f5f0ff" },
    variables: {
      "--bg0": "#0b0914", "--bg1": "#12101f", "--bg2": "#19162a", "--bg3": "#241f3a",
      "--app-bg-opacity": "0.84",
      "--center-bg-tint": "rgba(11, 9, 20, 0.36)", "--center-bg-vignette": "rgba(6, 4, 13, 0.7)",
      "--line": "#2a2541", "--line2": "#443a62",
      "--scrollbar-track": "#090711", "--scrollbar-thumb": "#4f456d", "--scrollbar-thumb-hover": "#746495",
      "--panel-bg0": "rgba(11, 9, 20, 0.72)", "--panel-bg1": "rgba(18, 16, 31, 0.74)",
      "--panel-bg2": "rgba(25, 22, 42, 0.7)", "--panel-bg3": "rgba(36, 31, 58, 0.66)",
      "--tx0": "#f5f0ff", "--tx1": "#c9bfdd", "--tx2": "#817794",
      "--r-s": "0.25rem", "--r-m": "0.5rem", "--panel-backdrop-blur": "1rem"
    }
  },
  newsprint: {
    label: "Newsprint",
    description: "Warm paper, oxblood details, and an expressive editorial serif.",
    mode: "light",
    accent: "rose",
    accentPalette: {
      acc: "#982f45",
      accDim: "rgba(152, 47, 69, 0.13)",
      accInk: "#fff8ef",
      accLine: "rgba(152, 47, 69, 0.38)",
      okLine: "#c58f79"
    },
    displayFont: "editorial",
    preview: { background: "#eee7da", surface: "#ddd0bc", accent: "#982f45", text: "#2b2520" },
    variables: {
      "--bg0": "#eee7da", "--bg1": "#f8f2e7", "--bg2": "#e8decf", "--bg3": "#ddd0bc",
      "--app-bg-opacity": "0.86",
      "--center-bg-tint": "rgba(238, 231, 218, 0.34)", "--center-bg-vignette": "rgba(225, 214, 195, 0.58)",
      "--line": "#d4c7b3", "--line2": "#b9a78e",
      "--scrollbar-track": "#e4dacb", "--scrollbar-thumb": "#ad9c85", "--scrollbar-thumb-hover": "#796c5d",
      "--panel-bg0": "rgba(238, 231, 218, 0.72)", "--panel-bg1": "rgba(248, 242, 231, 0.76)",
      "--panel-bg2": "rgba(232, 222, 207, 0.7)", "--panel-bg3": "rgba(221, 208, 188, 0.66)",
      "--tx0": "#2b2520", "--tx1": "#584c41", "--tx2": "#7f6f60",
      "--r-s": "0", "--r-m": "0.125rem", "--panel-backdrop-blur": "0.5rem"
    }
  },
  crt: {
    label: "Amber CRT",
    description: "Near-black phosphor glass, hard edges, and pure terminal mono.",
    mode: "dark",
    accent: "amber",
    accentPalette: {
      acc: "#ffb72f",
      accDim: "rgba(255, 183, 47, 0.14)",
      accInk: "#170f02",
      accLine: "rgba(255, 183, 47, 0.44)",
      okLine: "#745720"
    },
    displayFont: "mono",
    preview: { background: "#090b07", surface: "#202214", accent: "#ffb72f", text: "#f1d88d" },
    variables: {
      "--bg0": "#090b07", "--bg1": "#10120c", "--bg2": "#17190f", "--bg3": "#202214",
      "--app-bg-opacity": "0.9",
      "--center-bg-tint": "rgba(9, 11, 7, 0.42)", "--center-bg-vignette": "rgba(4, 5, 3, 0.74)",
      "--line": "#292d1a", "--line2": "#464a29",
      "--scrollbar-track": "#080906", "--scrollbar-thumb": "#504923", "--scrollbar-thumb-hover": "#796a2b",
      "--panel-bg0": "rgba(9, 11, 7, 0.8)", "--panel-bg1": "rgba(16, 18, 12, 0.8)",
      "--panel-bg2": "rgba(23, 25, 15, 0.76)", "--panel-bg3": "rgba(32, 34, 20, 0.72)",
      "--tx0": "#f1d88d", "--tx1": "#c3a967", "--tx2": "#756941",
      "--r-s": "0", "--r-m": "0", "--panel-backdrop-blur": "0.25rem"
    }
  },
  blueprint: {
    label: "Blueprint",
    description: "Architectural navy, drafting lines, and bright cyan notation.",
    mode: "dark",
    accent: "cyan",
    accentPalette: {
      acc: "#56dcff",
      accDim: "rgba(86, 220, 255, 0.14)",
      accInk: "#04141e",
      accLine: "rgba(86, 220, 255, 0.44)",
      okLine: "#31748d"
    },
    displayFont: "space",
    preview: { background: "#061a2a", surface: "#123a58", accent: "#56dcff", text: "#edf8ff" },
    variables: {
      "--bg0": "#061a2a", "--bg1": "#092238", "--bg2": "#0d2d47", "--bg3": "#123a58",
      "--app-bg-opacity": "0.86",
      "--center-bg-tint": "rgba(6, 26, 42, 0.36)", "--center-bg-vignette": "rgba(2, 13, 22, 0.68)",
      "--line": "#174867", "--line2": "#29698e",
      "--scrollbar-track": "#051622", "--scrollbar-thumb": "#286584", "--scrollbar-thumb-hover": "#3f8eb1",
      "--panel-bg0": "rgba(6, 26, 42, 0.74)", "--panel-bg1": "rgba(9, 34, 56, 0.76)",
      "--panel-bg2": "rgba(13, 45, 71, 0.72)", "--panel-bg3": "rgba(18, 58, 88, 0.68)",
      "--tx0": "#edf8ff", "--tx1": "#afd2e5", "--tx2": "#719db6",
      "--r-s": "0.125rem", "--r-m": "0.25rem", "--panel-backdrop-blur": "0.75rem"
    }
  }
};
export const themePresetIds: ThemePresetId[] = ["custom", ...Object.keys(curatedThemePresets) as CuratedThemePresetId[]];

export function getDarkThemeVariables(): Record<string, string> {
  return {
    "--bg0": "#0b0d10",
    "--bg1": "#10131a",
    "--bg2": "#151923",
    "--bg3": "#1b2130",
    "--app-bg-opacity": "0.86",
    "--center-bg-tint": "rgba(11, 13, 16, 0.32)",
    "--center-bg-vignette": "rgba(11, 13, 16, 0.58)",
    "--line": "#1f2633",
    "--line2": "#2b3445",
    "--scrollbar-track": "#090b0e",
    "--scrollbar-thumb": "#344054",
    "--scrollbar-thumb-hover": "#536178",
    "--scrollbar-thumb-active": "#c3f53c",
    "--panel-bg0": "rgba(11, 13, 16, 0.68)",
    "--panel-bg1": "rgba(16, 19, 26, 0.7)",
    "--panel-bg2": "rgba(21, 25, 35, 0.64)",
    "--panel-bg3": "rgba(27, 33, 48, 0.6)",
    "--tx0": "#e9eef5",
    "--tx1": "#aab3c5",
    "--tx2": "#69748c"
  };
}

export function getLightThemeVariables(): Record<string, string> {
  return {
    "--bg0": "#eef1ed",
    "--bg1": "#f8faf6",
    "--bg2": "#eef2ec",
    "--bg3": "#e4eadf",
    "--app-bg-opacity": "0.82",
    "--center-bg-tint": "rgba(238, 241, 237, 0.32)",
    "--center-bg-vignette": "rgba(238, 241, 237, 0.56)",
    "--line": "#d8dfd4",
    "--line2": "#c1ccbd",
    "--scrollbar-track": "#e5eae3",
    "--scrollbar-thumb": "#9aa79b",
    "--scrollbar-thumb-hover": "#68766c",
    "--scrollbar-thumb-active": "#5b721e",
    "--panel-bg0": "rgba(238, 241, 237, 0.66)",
    "--panel-bg1": "rgba(248, 250, 246, 0.68)",
    "--panel-bg2": "rgba(238, 242, 236, 0.62)",
    "--panel-bg3": "rgba(228, 234, 223, 0.58)",
    "--tx0": "#151a17",
    "--tx1": "#344038",
    "--tx2": "#5f6d64"
  };
}


function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function makeAccentPalette(hex: string, mode: AppearanceMode): AccentPalette {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return { acc: hex, accInk: luminance > 0.179 ? "#101010" : "#ffffff", accDim: rgba(hex, mode === "dark" ? 0.14 : 0.12), accLine: rgba(hex, 0.4), okLine: rgba(hex, 0.45) };
}

function makeTheme(label: string, description: string, mode: AppearanceMode, accent: AccentColorId, displayFont: DisplayFontId, colors: [string, string, string, string, string, string, string, string]): CuratedThemePreset {
  const [bg0, bg1, bg2, bg3, tx0, tx1, tx2, signal] = colors;
  return {
    label, description, mode, accent, displayFont,
    accentPalette: makeAccentPalette(signal, mode),
    preview: { background: bg0, surface: bg3, text: tx0, accent: signal },
    variables: {
      "--bg0": bg0, "--bg1": bg1, "--bg2": bg2, "--bg3": bg3,
      "--tx0": tx0, "--tx1": tx1, "--tx2": tx2,
      "--line": bg3, "--line2": tx2,
      "--center-bg-tint": rgba(bg0, 0.32), "--center-bg-vignette": rgba(bg0, 0.68),
      "--panel-bg0": rgba(bg0, 0.72), "--panel-bg1": rgba(bg1, 0.76),
      "--panel-bg2": rgba(bg2, 0.72), "--panel-bg3": rgba(bg3, 0.68),
      "--scrollbar-track": bg0, "--scrollbar-thumb": bg3, "--scrollbar-thumb-hover": tx2,
      "--r-s": "0.375rem", "--r-m": "0.625rem", "--panel-backdrop-blur": "0.75rem"
    }
  };
}

export function defaultProfile(): AppearanceProfile {
  return { themePreset: "custom", accent: "lime", accentOverride: false, customAccent: null, displayFont: "space", bodyFont: null, background: null, backgroundOpacity: null, backgroundBlur: 6, backgroundPosition: "center", backgroundFit: "cover", corners: "theme" };
}

export function defaultAppearanceSettings(): AppearanceSettings {
  return { version: 2, mode: "dark", profiles: { dark: defaultProfile(), light: defaultProfile() }, backgroundImages: [], savedLooks: [] };
}

export function updateProfile(settings: AppearanceSettings, mode: AppearanceMode, patch: Partial<AppearanceProfile>): AppearanceSettings {
  return { ...settings, profiles: { ...settings.profiles, [mode]: { ...settings.profiles[mode], ...patch } } };
}

export function applyThemePreset(settings: AppearanceSettings, mode: AppearanceMode, id: ThemePresetId): AppearanceSettings {
  const preset = id === "custom" ? null : curatedThemePresets[id];
  // Each palette belongs to one mode; applying it must never overwrite the other profile.
  const targetMode = preset?.mode ?? mode;
  return updateProfile({ ...settings, mode: targetMode }, targetMode, {
    themePreset: id, accent: preset?.accent ?? settings.profiles[targetMode].accent,
    accentOverride: false, customAccent: null, displayFont: preset?.displayFont ?? settings.profiles[targetMode].displayFont,
    bodyFont: null, corners: "theme"
  });
}

export function getProfileStyle(profile: AppearanceProfile, mode: AppearanceMode): CSSProperties {
  const preset = profile.themePreset === "custom" ? null : curatedThemePresets[profile.themePreset];
  const theme = mode === "light" ? getLightThemeVariables() : getDarkThemeVariables();
  const palette = profile.customAccent ? makeAccentPalette(profile.customAccent, mode)
    : !profile.accentOverride && preset ? preset.accentPalette : accentPalettes[profile.accent][mode];
  const corners = { square: "0", soft: "0.375rem", round: "0.875rem" };
  return {
    fontFamily: "var(--font-body)",
    ...theme, "--r-s": "0.1875rem", "--r-m": "0.3125rem", "--panel-backdrop-blur": "0.75rem",
    "--app-corner-radius": profile.corners === "theme" ? "0" : corners[profile.corners],
    ...(preset?.variables ?? {}),
    "--acc": palette.acc, "--acc-dim": palette.accDim, "--acc-ink": palette.accInk, "--acc-line": palette.accLine,
    "--app-bg-image": profile.background ? `url(${JSON.stringify(profile.background.url)})` : "none",
    ...(profile.backgroundOpacity === null ? {} : { "--app-bg-opacity": String(profile.backgroundOpacity) }),
    "--app-bg-blur": `${profile.backgroundBlur}px`, "--app-bg-position": profile.backgroundPosition, "--app-bg-fit": profile.backgroundFit,
    "--font-body": profile.bodyFont ? displayFonts[profile.bodyFont].head : displayFonts[profile.displayFont].body,
    "--font-head": displayFonts[profile.displayFont].head,
    "--ok-line": palette.okLine, "--scrollbar-thumb-active": palette.acc,
    ...(profile.corners === "theme" ? {} : { "--r-s": corners[profile.corners], "--r-m": corners[profile.corners] })
  } as CSSProperties;
}

export function getAppearanceStyle(settings: AppearanceSettings): CSSProperties {
  return getProfileStyle(settings.profiles[settings.mode], settings.mode);
}

export function pathToBackgroundUrl(path: string): string {
  return `music-os-image://local/?path=${encodeURIComponent(path.replaceAll("\\", "/"))}`;
}

export function backgroundName(path: string): string {
  return path.replaceAll("\\", "/").split("/").pop() || "Background image";
}

export function addBackgroundImage(settings: AppearanceSettings, mode: AppearanceMode, image: SelectedBackgroundImage): AppearanceSettings {
  const normalized = { path: image.path, url: pathToBackgroundUrl(image.path) };
  const existing = settings.backgroundImages.find((item) => item.path === image.path);
  const entry = { ...normalized, id: existing?.id ?? crypto.randomUUID(), name: backgroundName(image.path), addedAt: new Date().toISOString() };
  return { ...updateProfile(settings, mode, { background: normalized }), backgroundImages: [entry, ...settings.backgroundImages.filter((item) => item.path !== image.path)].slice(0, 24) };
}

export function saveAppearanceLook(settings: AppearanceSettings, name: string): AppearanceSettings {
  const label = name.trim().slice(0, 60);
  if (!label) return settings;
  const look: SavedAppearanceLook = { id: crypto.randomUUID(), name: label, mode: settings.mode, profile: { ...settings.profiles[settings.mode] } };
  return { ...settings, savedLooks: [...settings.savedLooks, look] };
}

export function applyAppearanceLook(settings: AppearanceSettings, look: SavedAppearanceLook): AppearanceSettings {
  return { ...settings, mode: look.mode, profiles: { ...settings.profiles, [look.mode]: { ...look.profile } } };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function member<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === "string" && values.includes(value as T) ? value as T : fallback;
}
function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
function background(value: unknown): SelectedBackgroundImage | null {
  const item = record(value);
  return typeof item.path === "string" && item.path.trim() ? { path: item.path, url: pathToBackgroundUrl(item.path) } : null;
}
function normalizeProfile(value: unknown, mode: AppearanceMode): AppearanceProfile {
  const p = record(value), defaults = defaultProfile();
  const selected = member(p.themePreset, themePresetIds, "custom");
  const themePreset = selected === "custom" || curatedThemePresets[selected].mode === mode ? selected : "custom";
  return {
    ...defaults, themePreset,
    accent: member(p.accent, Object.keys(accentPalettes) as AccentColorId[], defaults.accent),
    accentOverride: p.accentOverride === true,
    customAccent: typeof p.customAccent === "string" && /^#[0-9a-f]{6}$/i.test(p.customAccent) ? p.customAccent : null,
    displayFont: member(p.displayFont, Object.keys(displayFonts) as DisplayFontId[], defaults.displayFont),
    bodyFont: typeof p.bodyFont === "string" && Object.hasOwn(displayFonts, p.bodyFont) ? p.bodyFont as DisplayFontId : null,
    background: background(p.background),
    backgroundOpacity: p.backgroundOpacity == null ? null : bounded(p.backgroundOpacity, 0, 1, 0.86),
    backgroundBlur: bounded(p.backgroundBlur, 0, 24, 6),
    backgroundPosition: member(p.backgroundPosition, ["center", "top", "bottom"], "center"),
    backgroundFit: member(p.backgroundFit, ["cover", "contain"], "cover"),
    corners: member(p.corners, ["theme", "square", "soft", "round"], "theme")
  };
}

export function normalizeAppearanceSettings(value: unknown): AppearanceSettings {
  const data = record(value), defaults = defaultAppearanceSettings();
  const mode = member(data.mode, appearanceModes, "dark");
  const images: SavedBackgroundImage[] = [];
  for (const entry of Array.isArray(data.backgroundImages) ? data.backgroundImages : []) {
    const item = record(entry), image = background(item);
    if (image && !images.some((other) => other.path === image.path)) images.push({ ...image,
      id: typeof item.id === "string" ? item.id : crypto.randomUUID(), name: backgroundName(image.path),
      addedAt: typeof item.addedAt === "string" ? item.addedAt : new Date().toISOString() });
  }
  if (data.version === 2) {
    const profiles = record(data.profiles);
    const savedLooks: SavedAppearanceLook[] = [];
    for (const entry of Array.isArray(data.savedLooks) ? data.savedLooks : []) {
      const item = record(entry);
      if (typeof item.id !== "string" || typeof item.name !== "string" || !item.name.trim() || (item.mode !== "dark" && item.mode !== "light")) continue;
      if (savedLooks.some((look) => look.id === item.id)) continue;
      savedLooks.push({ id: item.id, name: item.name.slice(0, 60), mode: item.mode, profile: normalizeProfile(item.profile, item.mode) });
    }
    return { version: 2, mode, profiles: { dark: normalizeProfile(profiles.dark, "dark"), light: normalizeProfile(profiles.light, "light") }, backgroundImages: images.slice(0, 24), savedLooks };
  }
  // v1 stored one visual profile and optionally one image for each mode. Preserve both images,
  // and seed the other mode from the user's existing font and accent choices.
  const id = member(data.themePreset, themePresetIds, "custom");
  const preset = id === "custom" ? null : curatedThemePresets[id];
  const activeMode = preset?.mode ?? mode;
  const legacyImage = background({ path: data.backgroundImagePath });
  const backgrounds = record(data.backgroundDefaults);
  for (const profileMode of appearanceModes) {
    defaults.profiles[profileMode] = normalizeProfile({ ...data,
      themePreset: profileMode === activeMode ? id : "custom",
      accent: preset?.accent ?? data.accent, displayFont: preset?.displayFont ?? data.displayFont,
      background: Object.hasOwn(backgrounds, profileMode) ? backgrounds[profileMode] : legacyImage
    }, profileMode);
  }
  return { ...defaults, mode: activeMode, backgroundImages: images.slice(0, 24) };
}

export function loadAppearanceSettings(storage?: Pick<Storage, "getItem">): AppearanceSettings {
  for (const key of [appearanceStorageKey, legacyAppearanceStorageKey]) {
    try {
      const raw = (storage ?? window.localStorage).getItem(key);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
        if (key === appearanceStorageKey && record(parsed).version !== 2) continue;
        return normalizeAppearanceSettings(parsed);
      }
    } catch { /* Try the legacy copy if the new save is unreadable. */ }
  }
  return defaultAppearanceSettings();
}
