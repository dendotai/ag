# ag

Run unattended coding-agent sessions over a repository's ready tickets, one
session per ticket, each in its own git worktree.

The tool is the runner. Its other subcommands exist to keep the runner
working on a machine: a check that git push and commit signing work, the
per-project values a session needs, and the keychain that holds them.

Status: design. No code yet. See the issues.
