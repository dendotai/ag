#!/usr/bin/env bun
import { pickAdapter } from "./adapter.ts";
import { loadConfig } from "./config.ts";
import { gitIn, worktreeName } from "./worktree.ts";

const USAGE = `usage: ag <command>

  worktree setup    give this worktree its own environment and env files`;

class UsageError extends Error {}

async function worktreeSetup(argv: string[]): Promise<void> {
  if (argv.length > 0) throw new UsageError(`unexpected argument: ${argv.join(" ")}`);
  const root = process.cwd();
  const config = await loadConfig(root);
  const name = worktreeName(root, gitIn(root));
  await pickAdapter(root, config).setup(name);
}

async function main(argv: string[]): Promise<void> {
  const [group, command, ...rest] = argv;
  if (group === "worktree" && command === "setup") return worktreeSetup(rest);
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
