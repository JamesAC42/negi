# Playback Setup

Phase 2 uses `mpv` as the playback engine. The backend reads the executable path from `MUSIC_OS_MPV_PATH`.

## WSL With Windows mpv

This workspace has a Windows mpv binary at:

```text
/mnt/c/Program Files/mpv-x86_64-20181002/mpv.exe
```

Run the backend with:

```bash
MUSIC_OS_MPV_PATH="/mnt/c/Program Files/mpv-x86_64-20181002/mpv.exe" npm run dev:backend
```

Verify the configured binary with:

```bash
MUSIC_OS_MPV_PATH="/mnt/c/Program Files/mpv-x86_64-20181002/mpv.exe" npm run mpv:check --workspace @music-os/backend
```

## Native WSL mpv

If `mpv` is installed inside WSL and available on `PATH`, no environment variable is required:

```bash
npm run mpv:check --workspace @music-os/backend
```

