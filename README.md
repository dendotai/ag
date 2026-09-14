# ag

Run unattended coding-agent sessions over a repository's ready tickets, one
session per ticket, each in its own git worktree.

The tool is the runner. Its other subcommands exist to keep the runner
working on a machine: a check that git push and commit signing work, the
per-project values a session needs, and the keychain that holds them.

Status: early. `ag worktree setup` exists; the other subcommands are tracked
in the issues.

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
    // "none", "in <n> minutes|hours|days", a UTC datetime, or a UNIX timestamp. Absent: Convex's default.
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

## Develop

```sh
bun install
bun run check      # lint + typecheck + test
bun test           # engine tests need no git or convex; adapter and cli tests use a fake convex
```
