#!/usr/bin/env bun
// Every subcommand is imported on demand: the stop hook runs at the end of
// every session turn and must start fast.
const USAGE = `usage: ag <command>

  worktree setup    give this worktree its own environment and env files
  dash              local dashboard over the runner's tickets, sessions, branches and PRs
  stop-hook         Stop hook of a runner session (reads the hook JSON on stdin)
`;

class UsageError extends Error {}

async function worktreeSetup(argv: string[]): Promise<void> {
  if (argv.length > 0) throw new UsageError(`unexpected argument: ${argv.join(" ")}`);
  const [{ pickAdapter }, { loadConfig }, { gitIn, worktreeName }] = await Promise.all([
    import("./adapter.ts"),
    import("./config.ts"),
    import("./worktree.ts"),
  ]);
  const root = process.cwd();
  const config = await loadConfig(root);
  const name = worktreeName(root, gitIn(root));
  await pickAdapter(root, config).setup(name);
}

async function main(argv: string[]): Promise<void> {
  const [group, command, ...rest] = argv;
  switch (group) {
    case "worktree":
      if (command === "setup") return worktreeSetup(rest);
      break;
    case "dash":
      return (await import("./dash/serve.ts")).dashMain();
    case "stop-hook":
      return (await import("./stop-hook.ts")).stopHookMain();
    case undefined:
    case "-h":
    case "--help":
    case "help":
      process.stdout.write(USAGE);
      return;
  }
  throw new UsageError(USAGE);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(
    `\n${(error instanceof Error ? error.message : String(error)).replace(/^/gm, "  ")}\n`,
  );
  process.exit(error instanceof UsageError ? 2 : 1);
}
