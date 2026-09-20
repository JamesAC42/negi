# Music OS development environment

## Working on Music OS

- Complete requested changes through implementation and focused verification. Use the existing architecture and visual conventions to resolve routine choices; ask only when a missing decision materially changes the result.
- Keep the requested behavior and acceptance criteria in view across long tasks and mid-task corrections. Preserve unrelated work already present in this checkout.
- For substantial work with independent parts, use subagents when available to save time or improve quality: for example, backend investigation alongside renderer implementation, or a focused review alongside implementation. Give each agent a bounded task and separate file ownership; keep shared schema edits coordinated by one owner. Integrate and verify their results. Handle small or tightly coupled tasks directly.
- Use the current task's subagents for delegated work. Create a separate user-visible Codex task only when the user asks for one.
- Use `rg` for targeted discovery and batch independent reads. Inspect the relevant package scripts and nearby code before adding new patterns or commands.

## Repository map

- `apps/backend`: HTTP API, library/import/discovery services, and playback ownership.
- `apps/desktop/src/renderer`: React interface and styling. Electron main/preload changes require the managed rebuild/sync path below.
- `packages/core`: shared types and schemas; changes can affect both backend and desktop.
- `packages/db`, `packages/playback`, `packages/operations`, and `packages/connectors`: supporting workspace packages; inspect their actual implementation before deciding ownership.
- `docs`: design and implementation context. Consult documents relevant to the change and verify older descriptions against the current code.
- The music app's `MUSIC_OS_OPENAI_MODEL` is independent of the model used by Codex. Changing Codex preferences does not imply migrating the app's API integration.

## Authoritative checkout

- The live development checkout is `/home/james/code/musicplayer` in the `Ubuntu` WSL distribution.
- `E:\Documents\Github\musicplayer` is a separate Windows checkout. Do not edit it for changes intended for the running app unless the user explicitly asks to update that checkout.
- At the start of repository work, confirm the target with `pwd`, `git status --short`, and the running process command/cwd. Preserve all existing user changes.
- When a Codex session starts from the Windows checkout, inspect and edit the WSL checkout with commands such as `wsl.exe -- bash -lc "source ~/.nvm/nvm.sh && cd ~/code/musicplayer && ..."`. Use the active tool approval mechanism when access outside the current workspace requires it; do not add a separate confirmation for work already authorized by the user.

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

The Windows development shell defaults to `%LOCALAPPDATA%\\negi-dev-shell`. Override it
with `MUSIC_OS_ELECTRON_SHELL` when necessary. The production app lives in
`%LOCALAPPDATA%\\negi` after `npm run build:app`. Vite file polling is off by
default; set `MUSIC_OS_VITE_POLL=1` only if HMR misses edits.

## Production launch

From the WSL checkout:

```bash
source ~/.nvm/nvm.sh
cd ~/code/musicplayer
npm run build:app
```

Then launch `%LOCALAPPDATA%\\negi\\negi.lnk` from Windows. Electron starts the
WSL backend with `tsx` (no watch) and loads the packaged renderer. Close the
window to stop a backend that this launch started. slskd is still separate.

`npm run start:app` builds and launches that production window from WSL.
`npm run dev` only starts the Vite renderer; use `npm run dev:app` for daily
development.

## Playback environment

- Playback is owned by the backend under `apps/backend`.
- mpv is a Windows executable launched from WSL. Its path is configured by `MUSIC_OS_MPV_PATH`.
- Windows named-pipe IPC uses `MUSIC_OS_WINDOWS_NODE_PATH` when configured.
- Under `dev:app`, backend source changes restart automatically. A renderer
  refresh alone still cannot load backend changes.

## Validation

Choose validation based on the change:

- For code changes, run the backend and desktop typechecks below, plus the closest relevant smoke script. Shared package changes also need that package's available checks.
- For UI changes, inspect the result in the running app/browser when available, including relevant interaction and responsive behavior. State any visual verification limitation.
- For documentation or Codex configuration changes only, check syntax, referenced paths/commands, and `git diff --check`; application typechecks and playback smoke tests are unnecessary.
- Prefer isolated fixtures for tests. Inspect live smoke scripts before running them; they may start playback, use paid APIs, or modify the live music library. Use them when the requested behavior and authorization warrant those effects.
- Stop after relevant checks pass. Do not repeatedly run broad suites without a new change or unresolved failure. Report failures and distinguish pre-existing issues from regressions caused by this task.

Run code validation from the authoritative WSL checkout with NVM loaded:

```bash
npm run typecheck --workspace @music-os/backend
npm run typecheck --workspace @music-os/desktop
```

Use the closest smoke script from the relevant workspace. Playback auto-advance coverage is:

```bash
npm run playback-advance:smoke --workspace @music-os/backend
```

Real playback smoke tests require the configured Windows mpv and Windows Node paths to be reachable from WSL.
