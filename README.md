# ag

Run unattended coding-agent sessions over a repository's ready tickets, one
session per ticket, each in its own git worktree.

The tool is the runner. Its other subcommands exist to keep the runner
working on a machine: a check that git push and commit signing work, the
per-project values a session needs, and the keychain that holds them.

Status: early. `ag setup` exists; the other subcommands are tracked in the
issues.

## Install

`ag` is not on npm yet. A project pins it as a dev dependency at a git commit
and exposes it as a package script:

```json
{
  "devDependencies": { "@den-ai/ag": "github:dendotai/ag#<sha>" },
  "scripts": { "worktree:setup": "ag setup" }
}
```

bun runs the TypeScript directly: no build step, no runtime dependencies.

## `ag setup`

```
ag setup [--name <name>] [--port <port>] [--expires <days>|never]
```

Gives the current checkout its own isolated dev environment and writes the
env files that point at it, so several checkouts of a project run side by
side. Idempotent: a rerun keeps an environment that exists and replaces one
that is gone.

The **engine** decides, and each decision has a flag that overrides it:

- **Name.** In a git worktree the environment is named after the worktree
  directory. In the main checkout it is the developer's own environment.
  `--name` forces the worktree form with that name.
- **Port.** A worktree gets a free port in 3001–3099, skipping every port a
  sibling worktree already holds in its env file; a rerun keeps the port the
  checkout has. 3000 belongs to the main checkout. `--port` overrides.
- **Lifetime.** 14 days for a worktree environment, none for the main
  checkout. `--expires <days>` or `--expires never` overrides.

The **adapter** turns those three values into an environment for the
project's stack and knows nothing about worktrees. It is picked by the
project's files; a config file will replace that.

### Convex adapter

Picked when a workspace holds a `convex/` directory. The environment is a
Convex dev deployment, selected or created through the project's own
`convex` CLI, whose login is the credential; nothing is stored. The team and
project slugs are read from the API package's `package.json` under `convex`
(`team`, `project`); the template's placeholder slugs are refused.

- Worktree form: `<team>:<project>:dev/agent/<name>`, created with the
  lifetime as its expiration. Main checkout: the personal dev deployment.
- On a create, the values the first push needs are set when absent: a
  generated `BETTER_AUTH_SECRET`, `SITE_URL=http://localhost:<port>`, and
  placeholder Google client values. Then one push, `convex dev --once`.
- Env files: `apps/web/.dev.vars` gets `CONVEX_URL`; `apps/web/.env.local`
  gets `VITE_CONVEX_URL` and, in the worktree form, `PORT`. Other lines in
  both files survive.

## Develop

```sh
bun install
bun run check      # lint + typecheck + test
bun test           # engine tests need no git or convex; adapter and cli tests use a fake convex
```
