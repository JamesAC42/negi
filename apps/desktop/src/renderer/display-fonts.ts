import {
  loadAppearanceSettings,
  type AppearanceSettings,
  type DisplayFontId
} from "./appearance";

const fontLoaders: Record<string, () => Promise<unknown>> = {
  "@fontsource-variable/dm-sans": () => import("@fontsource-variable/dm-sans"),
  "@fontsource-variable/fraunces": () => import("@fontsource-variable/fraunces"),
  "@fontsource-variable/inter": () => import("@fontsource-variable/inter"),
  "@fontsource-variable/jetbrains-mono": () => import("@fontsource-variable/jetbrains-mono/index.css"),
  "@fontsource-variable/lora": () => import("@fontsource-variable/lora"),
  "@fontsource-variable/manrope": () => import("@fontsource-variable/manrope"),
  "@fontsource-variable/outfit": () => import("@fontsource-variable/outfit"),
  "@fontsource-variable/roboto-slab": () => import("@fontsource-variable/roboto-slab"),
  "@fontsource-variable/space-grotesk": () => import("@fontsource-variable/space-grotesk/index.css"),
  "@fontsource-variable/syne": () => import("@fontsource-variable/syne")
};

const packagesForFont: Record<DisplayFontId, string[]> = {
  space: ["@fontsource-variable/space-grotesk", "@fontsource-variable/jetbrains-mono"],
  grotesk: ["@fontsource-variable/space-grotesk"],
  mono: ["@fontsource-variable/jetbrains-mono"],
  system: [],
  wide: ["@fontsource-variable/jetbrains-mono"],
  editorial: ["@fontsource-variable/fraunces"],
  avant: ["@fontsource-variable/syne", "@fontsource-variable/space-grotesk"],
  inter: ["@fontsource-variable/inter"],
  manrope: ["@fontsource-variable/manrope"],
  outfit: ["@fontsource-variable/outfit", "@fontsource-variable/inter"],
  dm: ["@fontsource-variable/dm-sans"],
  lora: ["@fontsource-variable/lora", "@fontsource-variable/inter"],
  slab: ["@fontsource-variable/roboto-slab", "@fontsource-variable/dm-sans"]
};

const loaded = new Set<string>();
const inflight = new Map<string, Promise<void>>();

export function loadAppearanceFonts(settings: AppearanceSettings = loadAppearanceSettings()): Promise<void> {
  const ids = new Set<DisplayFontId>();
  for (const profile of Object.values(settings.profiles)) {
    ids.add(profile.displayFont);
    if (profile.bodyFont) ids.add(profile.bodyFont);
  }
  return loadDisplayFonts([...ids]);
}

export function loadAllDisplayFonts(): Promise<void> {
  return loadDisplayFonts(Object.keys(packagesForFont) as DisplayFontId[]);
}

export function loadDisplayFonts(ids: DisplayFontId[]): Promise<void> {
  const packages = new Set<string>();
  for (const id of ids) {
    for (const fontPackage of packagesForFont[id] ?? []) packages.add(fontPackage);
  }
  return Promise.all([...packages].map(loadFontPackage)).then(() => undefined);
}

function loadFontPackage(fontPackage: string): Promise<void> {
  if (loaded.has(fontPackage)) return Promise.resolve();
  const pending = inflight.get(fontPackage);
  if (pending) return pending;
  const loader = fontLoaders[fontPackage];
  if (!loader) return Promise.resolve();
  const work = loader()
    .then(() => {
      loaded.add(fontPackage);
    })
    .catch(() => undefined)
    .finally(() => {
      inflight.delete(fontPackage);
    });
  inflight.set(fontPackage, work);
  return work;
}
