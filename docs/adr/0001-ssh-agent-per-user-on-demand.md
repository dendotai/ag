# ADR 0001 — One on-demand ssh-agent per user, and no wrapper programs

## Status

Accepted (2026-09-17).

## Context

An unattended session must push a branch and create signed commits with no
human present. Two forces set the shape of the answer.

The credential must never prompt. A passphrase-protected key file, or a secret
manager's own SSH agent, answers by asking a human, which stops the session.
Signing is the second operation that hits the same wall, not a separate
problem.

The private key must never be a plaintext file on disk, and its source of
truth is the developer's secret manager. A human imports it once; nothing
reads the secret manager afterwards, so a locked manager never blocks a later
session. OpenSSH accepts a key only from a file or from an agent, so an agent
is required.

The question that remained was who starts that agent and how long it lives.
An earlier version of this design used one agent per session, with the socket
inside the worktree. Its stated reasons were that a shared socket needed
cross-session coordination, and that a socket inside the worktree is found
from the working directory with no environment variable to inherit. Both
reasons turned out to be wrong, which is why this record exists.

## Decision

One `ssh-agent` per user at `~/.ag/run/ssh-agent.sock`.

ag starts it lazily: if `ssh-add -l` finds no agent at that socket, ag starts
`ssh-agent -a <socket>` and loads the key from the platform keychain with
`<keychain read> | ssh-add -`. That is the whole lifetime policy. Nothing
kills it. A reboot removes the socket, and the same check restarts it.

ag adds no wrapper programs. `ssh`, `ssh-keygen -Y sign` and `ssh-add` all
honour `SSH_AUTH_SOCK`, so `SSH_AUTH_SOCK` plus `gpg.format=ssh`,
`user.signingKey` and `commit.gpgsign=true` in the session's environment are
enough. ag passes them in `<worktree>/.ag/run/claude/settings.json` and starts
the session with `claude --settings <that file>`, which ranks above the user's
own settings file and below managed settings. No file outside `.ag/` is
touched, and nothing survives the worktree.

## Consequences

- **Positive.** Two acceptance criteria disappear with the per-session model:
  replacing a socket left behind by a killed session, and a fallback for a
  socket path longer than the 103-character unix socket limit. The home
  directory path is about 34 characters, so the limit is not reachable.
- **Positive.** This matches every purpose-built agent. `gpg-agent` is
  "automatically started on demand … thus there is no reason to start it
  manually"; the macOS launchd job, the Debian systemd user unit, and the
  common secret-manager agents are all long-lived and per-user.
- **Accepted trade-off.** Two sessions can still try to start the agent at
  once. The bind is exclusive, so the loser probes again and finds the
  winner's agent; only a socket file proven dead is unlinked. This replaces a
  lock directory, a wait loop and a timeout error path with a short retry.
- **Accepted trade-off.** The agent is reachable by any process running as
  that user for as long as it lives. The alternative that narrows the window
  is a fresh agent per git command, which pays a keychain read on every
  commit.
- **Accepted trade-off.** `ssh-add -` reading a key from standard input is in
  the OpenSSH source and works, but the manual page does not document it. The
  preflight check exercises it rather than assuming it.
- **Open.** If a session must also reach other SSH hosts with other keys,
  `GIT_SSH_COMMAND="ssh -o IdentityAgent=<socket>"` returns for push, with
  `SSH_AUTH_SOCK` scoped to signing. That is the one case that would bring a
  wrapper back.
- **Open.** Reading one secret from a platform keychain is the only
  platform-specific step: `security` on macOS, `secret-tool` on Linux, and
  nothing built in on Windows.

## Rejected

1. **One agent per session, socket inside the worktree.** Its coordination
   argument was based on avoidable code: the race it guarded came from one
   unconditional socket delete, not from sharing a socket. Its
   no-environment-variable argument no longer applies, because the session's
   environment now carries `SSH_AUTH_SOCK`. What remains is pure cost — start
   and stop wiring, a path-length fallback, and a sidecar file naming where
   the socket really went.
2. **A fresh agent per git command.** It removes every socket concern, and
   pays a keychain read and a key load on every signed commit and every push.
3. **An evergreen agent owned by the OS**, through a launchd job or a systemd
   user unit. The lifetime policy above already reaches the same steady state
   with an `ssh-add -l` check, and this adds an installer and a per-platform
   branch.
4. **Creating commits through GitHub's API.** The only mechanism with no local
   key, and GitHub signs the result as verified. Declined because the commit
   author becomes the token's owner, every commit re-uploads whole files,
   history costs one call per commit, and the worktree must be re-fetched
   after each call. It replaces `git push` with a different workflow that
   every session must follow, and it still needs a store that opens without a
   human to hold the token.
5. **An HTTPS remote with a token in a git credential helper.** Removes the
   agent from push only. Signing still needs a key on the machine, so the
   agent returns and the result is two mechanisms instead of one.
6. **A signing service behind a signing shim**, as hosted agents use. ag runs
   on a developer's machine; there is no service to sign against and no
   published key to verify against.
7. **Writing the routing into the Claude Code settings file.** A tool
   configures the processes it starts. `claude --settings <file>` reaches the
   same session at a higher rank, writes nothing outside `.ag/`, and leaves
   the user's own entries in force.
8. **A worktree-local `.claude/settings.local.json`.** Also local, and also
   disappears with the worktree, but it ranks one level lower than
   `--settings` and puts ag's state inside a directory another tool owns.
