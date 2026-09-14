#!/usr/bin/env bun
import { pickAdapter } from "./adapter.ts";
import { loadConfig } from "./config.ts";
import { gitIn, planSetup, type SetupOverrides } from "./worktree.ts";

const USAGE = `usage: ag <command>

  worktree setup [--name <name>] [--expires <days>|never]
      give this worktree its own environment and env files`;

class UsageError extends Error {}

type Flags = Record<string, string>;

function parseFlags(argv: string[]): Flags {
  const out: Flags = {};
  for (let i = 0; i < argv.length; i += 2) {
    const arg = argv[i] as string;
    const value = argv[i + 1];
    if (!arg.startsWith("--")) throw new UsageError(`unexpected argument: ${arg}`);
    if (value === undefined || value.startsWith("--")) throw new UsageError(`${arg} needs a value`);
    out[arg.slice(2)] = value;
  }
  return out;
}

function setupOverrides(flags: Flags): SetupOverrides {
  const overrides: SetupOverrides = {};
  for (const [key, value] of Object.entries(flags)) {
    if (key === "name") {
      if (value === "") throw new UsageError("--name must not be empty");
      overrides.name = value;
    } else if (key === "expires") {
      const days = Number(value);
      if (value === "never") overrides.expires = null;
      else if (Number.isInteger(days) && days > 0) overrides.expires = days;
      else throw new UsageError(`--expires must be a number of days or "never": ${value}`);
    } else {
      throw new UsageError(`unknown flag: --${key}`);
    }
  }
  return overrides;
}

async function worktreeSetup(argv: string[]): Promise<void> {
  const overrides = setupOverrides(parseFlags(argv));
  const root = process.cwd();
  const config = await loadConfig(root);
  const plan = planSetup({ root, git: gitIn(root), overrides });
  await pickAdapter(root, config).setup(plan);
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
