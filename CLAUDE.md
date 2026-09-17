# ag

## Principles

### Self-contained

ag owns two directories: `.ag/` in a repository, and `~/.ag/` for the user.
Everything ag writes lives in one of them. A machine with ag removed looks
like a machine that never had it.

### ag configures what it starts

ag launches the session, so the session's environment belongs to ag. Push
authentication, signing config and paths reach a session as environment
variables on that process. Nothing has to be installed into a session, or
around it, for ag to work.

### Foreign config is read, not written

The Claude Code settings file, a shell profile, the global git config and
`~/.ssh/config` belong to their owners. ag reads them and reports what it
finds. Where only a shared file can carry a setting, that is a limit of the
platform, and it is named as one.

### Common tools over wrappers

ag routes work through the tools a developer already has — `ssh`, `git`,
`ssh-keygen` — configured to do what ag needs. A program of ag's own is added
only when no configuration of the common tool will do. An agent handles a
common tool's flags, output and errors reliably, because they are the ones it
already knows. A wrapper is one more thing to learn, and it hides the tool's
own messages. Where a wrapper cannot be avoided, it passes the tool's exit
code and output through unchanged.

### Conventional over clever

ag uses the mechanism its platform documents. An undocumented trick that keeps
ag self-contained is a trade to weigh in the open, not a free win.
