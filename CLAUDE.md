# ag

## Principles

### Self-contained

ag's data lives in two directories: `.ag/` at the root of each repository ag works on (and of each worktree ag makes in it), and `~/.ag/` for the user. ag's data is everything the `ag` CLI writes. The desktop app writes none of it: it reads and acts through `ag` commands.

The desktop app's technical files (window state, web view data, caches) live where the platform keeps an installed app's files, because every app that pairs a CLI with a desktop app splits its files this way. Removing ag means deleting `~/.ag/`, each repository's `.ag/`, the `ag` binary in `~/.local/bin/`, the `# ag` lines that `ag` added to a shell file, the app, and the app's platform folders.

### ag configures what it starts

ag launches the session, so the session's environment belongs to ag. Push authentication, signing config and paths reach a session as environment variables on that process. Nothing has to be installed into a session, or around it, for ag to work.

### Foreign config is read, not written

The Claude Code settings file, a shell profile, the global git config and `~/.ssh/config` belong to their owners. ag reads them and reports what it finds. Where only a shared file can carry a setting, that is a limit of the platform, and it is named as one.

### Common tools over wrappers

ag routes work through the tools a developer already has — `ssh`, `git`, `ssh-keygen` — configured to do what ag needs. A program of ag's own is added only when no configuration of the common tool will do. An agent handles a common tool's flags, output and errors reliably, because they are the ones it already knows. A wrapper is one more thing to learn, and it hides the tool's own messages. Where a wrapper cannot be avoided, it passes the tool's exit code and output through unchanged.

### Conventional over clever

ag uses the mechanism its platform documents. An undocumented trick that keeps ag self-contained is a trade to weigh in the open, not a free win.
