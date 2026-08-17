# Music OS development environment

## Authoritative checkout

- The live development checkout is `/home/james/code/musicplayer` in the `Ubuntu` WSL distribution.
- `E:\Documents\Github\musicplayer` is a separate Windows checkout. Do not edit it for changes intended for the running app unless the user explicitly asks to update that checkout.
- At the start of repository work, confirm the target with `pwd`, `git status --short`, and the running process command/cwd. Preserve all existing user changes.
- When a Codex session starts from the Windows checkout, inspect and edit the WSL checkout with commands such as `wsl.exe -- bash -lc "source ~/.nvm/nvm.sh && cd ~/code/musicplayer && ..."`. Request approval when access outside the current workspace is required.

## Starting development

Use separate WSL terminals. Load NVM before running Node commands:

```bash
source ~/.nvm/nvm.sh
cd ~/code/musicplayer
```

Backend:

```bash
npm run dev --workspace @music-os/backend
```

Renderer/client:

```bash
npm run dev --workspace @music-os/desktop
```

The backend command runs `tsx src/server.ts` without watch mode. After backend source, configuration, or environment changes, stop it with Ctrl+C and run the backend command again. Vite normally hot-reloads renderer changes; restart it after dependency or Vite configuration changes.

## Playback environment

- Playback is owned by the backend under `apps/backend`.
- mpv is a Windows executable launched from WSL. Its path is configured by `MUSIC_OS_MPV_PATH`.
- Windows named-pipe IPC uses `MUSIC_OS_WINDOWS_NODE_PATH` when configured.
- For playback bugs, restart the backend; a renderer restart alone cannot load backend changes.

## Validation

Run validation from the authoritative WSL checkout with NVM loaded:

```bash
npm run typecheck --workspace @music-os/backend
npm run typecheck --workspace @music-os/desktop
```

Use the closest smoke script from the relevant workspace. Playback auto-advance coverage is:

```bash
npm run playback-advance:smoke --workspace @music-os/backend
```

Real playback smoke tests require the configured Windows mpv and Windows Node paths to be reachable from WSL.
