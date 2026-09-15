# ag

Run unattended coding-agent sessions over a repository's ready tickets, one
session per ticket, each in its own git worktree.

The tool is the runner. Its other subcommands exist to keep the runner
working on a machine: a check that git push and commit signing work, the
per-project values a session needs, and the keychain that holds them.

Status: early. `ag worktree setup`, `ag dash` and `ag stop-hook` exist; the
other subcommands are tracked in the issues.

## Prerequisites

| Tool                   | Needed by                          |
| ---------------------- | ---------------------------------- |
| bun 1.2 or later       | every command                      |
| git                    | `ag worktree setup`, `ag dash`     |
| `gh`, authenticated    | `ag dash`, `ag stop-hook`          |
| `claude`               | `ag dash`, `ag stop-hook`          |

The project's own `convex` CLI comes from its `node_modules`, so it is not a
machine prerequisite.

Nothing checks these yet. A missing `gh` or `claude` makes a command return
an empty result instead of an error: `ag dash` renders a board with no
sessions, and `ag stop-hook` refuses to stop a session five times because it
cannot read the ticket's labels. #15 adds the checks.

## Install

`ag` is not on npm yet. A project pins it as a dev dependency at a git commit:

```json
{ "devDependencies": { "@den-ai/ag": "github:dendotai/ag#<sha>" } }
```

bun runs the TypeScript directly: no build step, no runtime dependencies.

## Configuration

ag reads one file, `ag.config.ts` at the project root, and guesses nothing
about the project. Without the file it stops and names it. The top level
names the adapter; everything else is that adapter's own section.

```ts
import { defineConfig } from "@den-ai/ag";

export default defineConfig({
  adapter: "convex",
  convex: {
    apiDir: "packages/api",
    team: "my-team",
    project: "my-project",
    // "none", "in <n> minutes|hours|days", a UTC datetime, or a UNIX timestamp.
    // Absent: ag passes "in 5 days". A dev deployment created without an
    // expiration never expires (Convex CLI 1.45), so ag always passes one.
    expiration: "in 14 days",
    // Values a fresh deployment needs before its first push. A value already
    // stored is never touched, so a rerun changes nothing and a value set by
    // hand survives.
    env: ({ secret }) => ({ AUTH_SECRET: secret() }),
    // Env files to write once the deployment exists, keyed by path relative to
    // the project root. Other lines in those files survive.
    files: ({ url }) => ({
      "apps/web/.env.local": { VITE_BACKEND_URL: url },
    }),
  },
});
```

## `ag worktree setup`

Gives the git worktree it runs in an isolated environment of its own, and
writes the env files that point at it. Idempotent: a rerun keeps an
environment that exists and replaces one that is gone. In the main checkout
it stops: the main checkout is set up by hand.

The **engine** decides one thing and knows no stack: the environment's name,
which is the worktree folder's name. ag decides nothing about ports. The
project's dev server takes a free port from the OS when it starts, and tells
its backend its address at that moment, if the backend needs one.

The **adapter** named in the config turns the name into an environment for
the project's stack.

### Convex adapter

The environment is a Convex dev deployment `<team>:<project>:dev/agent/<name>`,
selected or created through the project's own `convex` CLI, whose login is
the credential; nothing is stored. Create passes the config's `expiration`.
Then the adapter stores the config's `env` values the deployment lacks,
pushes once with `convex dev --once`, and writes the config's `files` with
the deployment's URL.

## `ag dash`

A local dashboard over every Claude session on the machine. Repositories are
discovered from the sessions' working directories, plus the one the
dashboard starts in. One row per ticket that has a worktree, a session, a
state label or a pull request in its repository; a session without a ticket
(an interactive chat, other background work) gets a row of its own. Open
`http://localhost:7878`.

| Column  | Content                                                                 |
| ------- | ----------------------------------------------------------------------- |
| Ticket  | number with link, title; for a ticketless session its kind and name    |
| Status  | `running`, `done`, `parked`, `stalled` or `idle` (see below)            |
| Session | short session id, running, finished or idle, start time                 |
| Branch  | name, commits ahead of the default branch, pushed to the remote or not  |
| PR      | number with link, `draft` when it is one                                |
| Labels  | the ticket's state labels                                               |

Status: `running` while the session is busy; `parked` when the ticket carries
`needs-human`; `done` when a non-draft pull request is open; `stalled` when
a background session ended without a pull request and without parking;
`idle` otherwise. A closed ticket stays listed only while a session runs or
a pull request is open; a finished ticketless session is not listed.

Sources: `claude agents --json --all`, `git worktree list`, `gh issue list`,
`gh pr list` and `git ls-remote`. A finished background session no longer
reports its worktree, so it is mapped to its ticket through the transcript
directory `~/.claude/projects/<cwd-slug>/<session-id>.jsonl`. Local sources
are polled every 2 seconds, GitHub every 10, and the page polls the JSON
endpoint `/api/state` every 5.

| Variable             | Default | Meaning                              |
| -------------------- | ------- | ------------------------------------ |
| `AGENT_DASH_PORT`    | `7878`  | port of the HTTP server              |
| `AGENT_DASH_POLL`    | `2`     | seconds between local polls          |
| `AGENT_DASH_POLL_GH` | `10`    | seconds between GitHub/remote polls  |

## `ag stop-hook`

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

## Develop

```sh
bun install
bun run check      # lint + typecheck + test
bun test           # engine tests need no git or convex; adapter and cli tests use a fake convex
```
