import assert from "node:assert/strict";
import {
  accentPalettes, addBackgroundImage, appearanceStorageKey, applyAppearanceLook, applyThemePreset,
  curatedThemePresets, defaultAppearanceSettings, displayFonts, getAppearanceStyle,
  legacyAppearanceStorageKey, loadAppearanceSettings, makeAccentPalette, normalizeAppearanceSettings,
  pathToBackgroundUrl, saveAppearanceLook, updateProfile
} from "../renderer/appearance.js";

const darkImage = { path: "C:\\Pictures\\night & stars.png", url: "discard-stale-url" };
const lightImage = { path: "/mnt/c/Pictures/day.jpg", url: "discard-stale-url" };
const legacy = { mode: "dark", themePreset: "nocturne", accent: "rose", displayFont: "mono", backgroundDefaults: { dark: darkImage, light: lightImage }, backgroundImages: [{ ...darkImage, id: "one", name: "Old", addedAt: "2026-01-01" }] };
const migrated = normalizeAppearanceSettings(legacy);
assert.equal(migrated.mode, "dark");
assert.equal(migrated.profiles.dark.themePreset, "nocturne");
assert.equal(migrated.profiles.dark.displayFont, "avant", "v1 preset font takes precedence, preserving the visible legacy look");
assert.equal(migrated.profiles.light.background?.path, lightImage.path);
assert.equal(migrated.profiles.dark.background?.url, pathToBackgroundUrl(darkImage.path));
assert.equal((getAppearanceStyle(migrated) as Record<string, string>)["--bg0"], "#0b0914");
assert.equal((getAppearanceStyle(migrated) as Record<string, string>)["--acc"], "#b89cff");

const legacySingle = normalizeAppearanceSettings({ mode: "light", backgroundImagePath: darkImage.path, accent: "cyan", displayFont: "wide" });
assert.equal(legacySingle.profiles.dark.background?.path, darkImage.path);
assert.equal(legacySingle.profiles.light.displayFont, "wide");
const cleared = normalizeAppearanceSettings({ ...legacy, backgroundImagePath: darkImage.path, backgroundDefaults: { dark: null, light: lightImage } });
assert.equal(cleared.profiles.dark.background, null, "explicitly cleared images must not be resurrected by legacy fallback");

for (const id of ["nocturne", "newsprint", "crt", "blueprint"] as const) {
  const old = normalizeAppearanceSettings({ mode: "dark", themePreset: id });
  assert.equal(old.mode, curatedThemePresets[id].mode);
  const style = getAppearanceStyle(old) as Record<string, string>;
  assert.equal(style["--acc"], curatedThemePresets[id].accentPalette.acc);
  assert.equal(style["--bg0"], curatedThemePresets[id].variables["--bg0"]);
}
for (const displayFont of Object.keys(displayFonts)) {
  const old = normalizeAppearanceSettings({ displayFont, mode: "dark", themePreset: "custom" });
  assert.equal(old.profiles.dark.displayFont, displayFont);
}
for (const accent of Object.keys(accentPalettes)) {
  assert.equal(normalizeAppearanceSettings({ accent }).profiles.dark.accent, accent);
}

let settings = applyThemePreset(migrated, "light", "linen");
const darkBefore = structuredClone(settings.profiles.dark);
settings = updateProfile(settings, "light", { displayFont: "inter", customAccent: "#123456", accentOverride: true, backgroundBlur: 18, backgroundPosition: "top", corners: "round" });
assert.deepEqual(settings.profiles.dark, darkBefore, "customizing light must preserve the entire dark profile");
assert.equal((getAppearanceStyle(settings) as Record<string, string>)["--bg0"], "#f3ede2", "changing font/accent must retain preset surfaces");
assert.equal((getAppearanceStyle(settings) as Record<string, string>)["--acc"], "#123456");
assert.equal(settings.profiles.light.themePreset, "linen");
const stored = JSON.stringify(settings);
settings = normalizeAppearanceSettings(JSON.parse(stored));
assert.equal(settings.profiles.light.customAccent, "#123456", "reload must preserve a customized preset");
assert.equal(settings.profiles.light.displayFont, "inter");
assert.equal(settings.profiles.dark.themePreset, "nocturne");
assert.equal(getAppearanceStyle({ ...settings, mode: "dark" })["--font-head" as keyof ReturnType<typeof getAppearanceStyle>], displayFonts.avant.head);
const activeBefore = structuredClone(settings.profiles.light);
settings = addBackgroundImage(settings, "dark", lightImage);
assert.equal(settings.mode, "light", "choosing an inactive mode's wallpaper must not switch modes");
assert.deepEqual(settings.profiles.light, activeBefore);
settings = addBackgroundImage(settings, "dark", lightImage);
assert.equal(settings.backgroundImages.filter((i) => i.path === lightImage.path).length, 1, "recent images deduplicate paths");
settings = saveAppearanceLook(settings, "  Daytime favorites  ");
assert.equal(settings.savedLooks[0].name, "Daytime favorites");
const saved = structuredClone(settings.savedLooks[0]);
settings = updateProfile(settings, "light", { customAccent: "#ff0000", displayFont: "slab" });
assert.deepEqual(settings.savedLooks[0], saved, "saved looks must remain independent snapshots");
const otherMode = structuredClone(settings.profiles.dark);
settings = applyAppearanceLook(settings, saved);
assert.deepEqual(settings.profiles.light, saved.profile);
assert.deepEqual(settings.profiles.dark, otherMode, "restoring a look must not overwrite the other mode");
assert.deepEqual(normalizeAppearanceSettings(JSON.parse(JSON.stringify(settings))), settings, "complete save/reload round trip");

for (const [id, preset] of Object.entries(curatedThemePresets)) {
  const applied = applyThemePreset(defaultAppearanceSettings(), preset.mode, id as keyof typeof curatedThemePresets);
  const style = getAppearanceStyle(applied) as Record<string, string>;
  for (const key of ["--bg0", "--tx0", "--acc", "--acc-ink", "--font-head", "--font-body"]) assert.ok(style[key], `${id} has ${key}`);
  assert.equal(normalizeAppearanceSettings(applied).profiles[preset.mode].themePreset, id);
}
assert.equal(makeAccentPalette("#ffffff", "light").accInk, "#101010");
assert.equal(makeAccentPalette("#000000", "dark").accInk, "#ffffff");
assert.equal(makeAccentPalette("#ff0000", "dark").accInk, "#101010");
const malformed = normalizeAppearanceSettings({ version: 2, mode: "unknown", profiles: { dark: { themePreset: "constructor", displayFont: "__proto__", customAccent: "url(evil)", backgroundBlur: 999, backgroundOpacity: -1 }, light: null }, savedLooks: [null, { id: "bad", mode: "purple" }] });
assert.equal(malformed.profiles.dark.themePreset, "custom");
assert.equal(malformed.profiles.dark.displayFont, "space");
assert.equal(malformed.profiles.dark.customAccent, null);
assert.equal(malformed.profiles.dark.backgroundBlur, 24);
assert.equal(malformed.profiles.dark.backgroundOpacity, 0);
assert.deepEqual(malformed.savedLooks, []);
const storage = { getItem: (key: string) => key === appearanceStorageKey ? "{invalid" : key === legacyAppearanceStorageKey ? JSON.stringify(legacy) : null };
assert.equal(loadAppearanceSettings(storage).profiles.dark.themePreset, "nocturne", "corrupted v2 must fall back to the untouched v1 copy");
assert.equal(loadAppearanceSettings({ getItem: () => { throw new Error("storage blocked"); } }).version, 2);
console.log(`Appearance smoke passed: legacy migration, ${Object.keys(curatedThemePresets).length} presets, ${Object.keys(displayFonts).length} font pairings, independent mode saves, image assignment, saved looks, and malformed storage.`);
