# ag

Run unattended coding-agent sessions over a repository's ready tickets, one
session per ticket, each in its own git worktree.

The tool is the runner. Its other subcommands exist to keep the runner
working on a machine: a check that git push and commit signing work, the
per-project values a session needs, and the keychain that holds them.

Status: design. No code yet. See the issues.

## `ag git`

Push auth and commit signing for agent sessions go through one ed25519 key
made for agents only. The key lives in the machine's login keychain; on
first use it is loaded into an in-memory `ssh-agent` at a fixed socket, and
every later push and signature reuses that agent. The key's source of truth
is the developer's secret manager, imported into the keychain once by the
human:

```sh
# for example, with the 1Password CLI
op read 'op://<vault>/<item>/private key?ssh-format=openssh' | ag git import
```

Git is routed to the key by the `env` block of the Claude Code settings file
(`~/.claude/settings.json`), which every session inherits:

```json
{
  "env": {
    "GIT_SSH_COMMAND": "<path to>/ag-git-ssh",
    "GIT_CONFIG_COUNT": "3",
    "GIT_CONFIG_KEY_0": "gpg.format",
    "GIT_CONFIG_VALUE_0": "ssh",
    "GIT_CONFIG_KEY_1": "gpg.ssh.program",
    "GIT_CONFIG_VALUE_1": "<path to>/ag-git-sign",
    "GIT_CONFIG_KEY_2": "user.signingkey",
    "GIT_CONFIG_VALUE_2": "ssh-ed25519 AAAA…"
  }
}
```

`ag-git-ssh` and `ag-git-sign` are argument-free programs of their own
because git runs `gpg.ssh.program` without a shell. `ag git check` exits 0
and prints the key's fingerprint when the routing is present, GitHub accepts
the key and a test signature succeeds; otherwise it exits 1 with a one-line
cause. The runner runs it before it claims the first ticket.
