# Music OS development environment

## Authoritative checkout

- The live development checkout is `/home/james/code/musicplayer` in the `Ubuntu` WSL distribution.
- `E:\Documents\Github\musicplayer` is a separate Windows checkout. Do not edit it for changes intended for the running app unless the user explicitly asks to update that checkout.
- At the start of repository work, confirm the target with `pwd`, `git status --short`, and the running process command/cwd. Preserve all existing user changes.
- When a Codex session starts from the Windows checkout, inspect and edit the WSL checkout with commands such as `wsl.exe -- bash -lc "source ~/.nvm/nvm.sh && cd ~/code/musicplayer && ..."`. Request approval when access outside the current workspace is required.

## Starting development

Run the managed development stack from the authoritative WSL checkout:

```bash
source ~/.nvm/nvm.sh
cd ~/code/musicplayer
npm run dev:app
```

This single foreground command:

- starts the backend in WSL with `tsx watch`;
- starts the renderer in WSL at `http://127.0.0.1:5173`;
- builds Electron main and preload from this checkout;
- synchronizes those bundles into the Windows `negi-dev-shell`;
- launches native Windows Electron against the WSL Vite server; and
- rebuilds, synchronizes, and restarts only Electron after main/preload changes.

Press Ctrl+C once in the managed terminal to stop every process it owns. These
commands are also available from another WSL terminal:

```bash
npm run dev:doctor
npm run dev:stop
npm run dev:sync
```

`dev:doctor` reports managed PIDs, commands, cwd values, port listeners,
service health, and whether the Windows Electron bundle matches the WSL build.
`dev:stop` touches only PIDs recorded by the managed stack. `dev:sync`
rebuilds and copies Electron main/preload without starting or stopping anything.

Do not manually launch the Windows `negi-dev-shell` for normal development,
because it can retain an old copied main bundle. If an unmanaged legacy backend
or Vite process owns a fixed port, `dev:app` stops with a clear error; inspect
it with `dev:doctor`, stop it once, and rerun `dev:app`.

The Windows shell defaults to `%LOCALAPPDATA%\\negi-dev-shell`. Override it
with `MUSIC_OS_ELECTRON_SHELL` when necessary.

## Playback environment

- Playback is owned by the backend under `apps/backend`.
- mpv is a Windows executable launched from WSL. Its path is configured by `MUSIC_OS_MPV_PATH`.
- Windows named-pipe IPC uses `MUSIC_OS_WINDOWS_NODE_PATH` when configured.
- Under `dev:app`, backend source changes restart automatically. A renderer
  refresh alone still cannot load backend changes.

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
