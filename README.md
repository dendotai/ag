# ag

Run unattended coding-agent sessions over a repository's ready tickets, one
session per ticket, each in its own git worktree.

The tool is the runner. Its other subcommands exist to keep the runner
working on a machine: a check that git push and commit signing work, the
per-project values a session needs, and the keychain that holds them.

Status: design, first subcommands landing. See the issues.

## Subcommands

### `ag dash`

A local dashboard over the runner's tickets of the current repository: one
row per ticket that has a worktree, a session, a state label or a pull
request. Run it from anywhere inside the repository and open
`http://localhost:7878`.

| Column  | Content                                                                 |
| ------- | ----------------------------------------------------------------------- |
| Ticket  | number with link, title                                                 |
| Status  | `running`, `done`, `parked`, `stalled` or `idle` (see below)            |
| Session | short session id, running or finished, start time                       |
| Branch  | name, commits ahead of the default branch, pushed to the remote or not  |
| PR      | number with link, `draft` when it is one                                |
| Labels  | the ticket's state labels                                               |

Status: `running` while the session is busy; `parked` when the ticket carries
`needs-human`; `done` when a non-draft pull request is open; `stalled` when
the session ended without a pull request and without parking; `idle` when
only a label is present. A closed ticket stays listed only while a session
runs or a pull request is open.

Sources: `claude agents --json --all`, `git worktree list`, `gh issue list`,
`gh pr list` and `git ls-remote`. A finished session no longer reports its
worktree, so it is mapped to its ticket through the transcript directory
`~/.claude/projects/<cwd-slug>/<session-id>.jsonl`. Local sources are polled
every 2 seconds, GitHub every 10, and the page polls the JSON endpoint
`/api/state` every 5.

| Variable             | Default | Meaning                              |
| -------------------- | ------- | ------------------------------------ |
| `AGENT_DASH_PORT`    | `7878`  | port of the HTTP server              |
| `AGENT_DASH_POLL`    | `2`     | seconds between local polls          |
| `AGENT_DASH_POLL_GH` | `10`    | seconds between GitHub/remote polls  |

### `ag stop-hook`

The `Stop` hook of a runner session. Claude Code runs it every time a turn
ends, with `session_id`, `cwd` and `stop_hook_active` as JSON on stdin. A
turn also ends while the session waits for a background subagent, so the
hook decides whether the session is done:

1. A `cwd` that is not an `impl-N` worktree: stop the session at once.
2. The ticket is closed, or carries `in-review` or `needs-human`: the session
   did its last step, stop it.
3. Otherwise refuse the stop with a reason that tells the session to collect
   pending subagents with `TaskOutput` and then finish: commit, push, open
   the pull request, set the label.
4. After `AGENT_MAX_STOP_BLOCKS` refusals (default 5) the session is stopped
   anyway.

The stop runs `claude stop <id>` detached from the hook and without
`CLAUDECODE` in the environment, because a child of the hook dies with the
hook and `CLAUDECODE` blocks nested `claude` commands.

The runner passes the hook at launch:

```json
{ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "ag stop-hook" }] }] } }
```

## Development

```sh
bun install
bun test
bun run typecheck
```

bun runs the TypeScript directly; there is no build step and no runtime
dependency.
