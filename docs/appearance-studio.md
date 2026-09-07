# Appearance studio

Open **Settings → Appearance**. Choose **After dark** or **In the light** to edit that mode. Changes save automatically on this device. The sun/moon button in the top bar switches between the two saved profiles without opening Settings.

## What is available

- 16 curated presets plus the original Custom palette. Original Nocturne, Newsprint, Amber CRT, and Blueprint remain available in their respective modes.
- New dark palettes: Forest, Carbon, Sakura, Lagoon, Espresso, Synthwave.
- New light palettes: Porcelain, Linen, Matcha, Lavender, Arctic, Peach.
- All seven original font choices plus six locally bundled families: Inter, Manrope, Outfit, DM Sans, Lora, Roboto Slab. Pairing cards preview headings and body text. The reading-font control can override the pairing separately.
- Original six accent choices, the preset's own accent, and a custom color picker with hex input. Custom colors choose contrasting button text automatically.
- Square, soft, or rounded corners, or the original workbench geometry.
- Independent backgrounds for light and dark, large clickable thumbnails, filenames, replace/clear actions, and recent-image thumbnails with explicit assignments to either mode. Missing files show a recovery message. Images stay on disk; removing a recent entry does not delete a file or clear an assigned wallpaper.
- Per-mode image strength, blur, fill/contain, and focal point, with a small interface preview.
- Named saved looks, including typography, colors, corner style, and wallpaper treatment. Applying a look switches to its mode and preserves the opposite profile.

Changing a font or accent keeps the selected preset's surfaces. Selecting a preset resets its typography, accent override, and corners while keeping that mode's wallpaper and image treatment.

## Persistence and compatibility

The renderer stores `music-os:appearance:v2`, with independent `profiles.dark` and `profiles.light` records and shared recent images and named looks. It migrates the original v1 visual selection into the active mode, seeds the other mode with the existing accent/font choices, and retains both mode-specific backgrounds. Explicitly cleared images remain cleared. The v1 key is left untouched as a recovery copy. Invalid data is normalized, and storage write failures are shown in Settings.

Local image selection uses the existing Electron file picker and `music-os-image` protocol. A plain browser shows a message directing the user to the desktop app for file selection.

## Validation

- `npm run appearance:smoke --workspace @music-os/desktop` covers migration, original selections, both profile saves, customizing preset surfaces, assigning an inactive mode's image, named looks, corrupt storage, and all preset/font definitions.
- Backend and desktop TypeScript checks.
- Desktop production build.
- Isolated Chromium interaction checks cover migration/reload, actual font application, mode switching, named looks, simulated native picker return/cancel, image recents, corner rendering, font loading, and a 960 px viewport without settings overflow.

The native Windows file dialog itself is not automated by the browser checks.
