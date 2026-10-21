# OpenBot Personal

This fork opens the local workspace without an OpenBot email account. The account service remains signed out. A local display identity does not grant cloud access. Model providers still require their own authentication.

The installed desktop entry is **OpenBot Personal**. Its default data directory is `~/.config/OpenBot Personal`. The original OpenBot AppImage and data directory remain separate.

## Isolation

The main process sets a private home and provider configuration paths before it starts provider processes. The packaged app also starts child processes from this home. Codex processes use this directory even when the parent starts in another repository.

The fork keeps its downloaded provider runtimes inside its own profile. It does not import personal plugin caches, skills, global instructions, or memory files. Its pinned Codex system skills start disabled. Automatic workspace skill installation and agent memory tools are disabled. Existing memory records remain stored for recovery, but the fork does not inject them into model context.

This is configuration isolation. Agents with full filesystem access can still read files outside the private home when instructed. Project instructions in a repository that you choose to work on can also apply. This change does not add an operating-system sandbox.

Provider authentication and runtime files are shared inside this fork profile. Each agent retains its own workspace and provider conversation. Other providers need a separate sign-in in the private home. Only Codex was verified with a real model reply for this change.

## Import existing agents

Use a new destination. The importer refuses to overwrite an existing profile.

```sh
python scripts/personal-profile.py "$HOME/.config/OpenBot" "$HOME/.config/OpenBot Personal"
bun scripts/personal-cutover.ts "$HOME/.config/OpenBot Personal"
```

Run the cutover before opening the copied profile. It retires old native provider sessions and pauses copied routines. It preserves agent IDs, public threads, and chat messages. Old chats remain visible. The next model session can receive a conversation handoff, which is separate from installed skills and saved memory.

The original database is opened read-only and copied through SQLite's backup API. Workspace instruction folders are excluded from the active copy. The original workspaces and a database snapshot are retained under the main checkout's ignored `.openbot/personal-backups/` directory. Shared transfer files are copied and their structured paths are relocated. No chat text is rewritten.

The importer copies only the existing private Codex authentication file. It does not copy the Codex configuration, skill directories, plugin directories, or native conversation history. It does not authenticate other providers automatically.

Do not use both app copies for the same unfinished task. Work after the import snapshot does not sync between them. The original app remains the recovery source for a task that was still running during import.

## Build and maintain

Use a task worktree. Install the lockfile, prepare the Linux Computer Use driver, and build the desktop package.

```sh
bun install --frozen-lockfile
bun scripts/install-cua-driver.ts linux x64
bun run build
bunx electron-builder --dir --linux --x64 --publish never
```

The desktop executable is `dist/linux-unpacked/openbot-personal`. Keep the whole directory together when installing it. This build does not include the optional remote virtual desktop runtime.

Application updates are disabled in personal mode. Pull upstream changes deliberately, build a separate version, and verify that version before replacing the installed directory. Keep the previous executable and a consistent database snapshot before an upgrade. An old binary alone is not a rollback after a schema migration.

The fork keeps the upstream PolyForm Noncommercial license. Fork ownership does not change its use restrictions.

## Focused verification

```sh
bun scripts/personal-mode-e2e.ts
python scripts/personal-provider-e2e.py "$HOME/.config/OpenBot Personal"
bun scripts/personal-chat-e2e.ts "$HOME/.config/OpenBot Personal"
```

These checks write reports under `.openbot-build/`. The provider check starts the real pinned Codex process and checks configuration, skills, and authentication without sending a prompt. The chat check runs the real OpenBot agent service against Codex in separate test state. It does not send a message to an imported agent.

Use `cu` for visible desktop verification on this machine. Verify that the copied agents and chats appear and that a complete quit and reopen does not show email login.
