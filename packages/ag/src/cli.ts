#!/usr/bin/env bun
import { pickAdapter } from "./adapter.ts";
import { gitIn, planSetup, type SetupOverrides } from "./worktree.ts";

const USAGE = `usage: ag <command>

  setup [--name <name>] [--port <port>] [--expires <days>|never]
      give this checkout its own environment and env files`;

class UsageError extends Error {}

function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (!arg.startsWith("--")) throw new UsageError(`unexpected argument: ${arg}`);
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq !== -1) {
      out[body.slice(0, eq)] = body.slice(eq + 1);
    } else {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--"))
        throw new UsageError(`--${body} needs a value`);
      out[body] = value;
      i++;
    }
  }
  return out;
}

function setupOverrides(flags: Record<string, string>): SetupOverrides {
  const overrides: SetupOverrides = {};
  for (const key of Object.keys(flags)) {
    if (!["name", "port", "expires"].includes(key)) throw new UsageError(`unknown flag: --${key}`);
  }
  if (flags.name !== undefined) overrides.name = flags.name;
  if (flags.port !== undefined) {
    const port = Number(flags.port);
    if (!Number.isInteger(port) || port <= 0)
      throw new UsageError(`--port must be a number: ${flags.port}`);
    overrides.port = port;
  }
  if (flags.expires !== undefined) {
    if (flags.expires === "never") {
      overrides.expires = null;
    } else {
      const days = Number(flags.expires);
      if (!Number.isInteger(days) || days <= 0) {
        throw new UsageError(`--expires must be a number of days or "never": ${flags.expires}`);
      }
      overrides.expires = days;
    }
  }
  return overrides;
}

async function setup(argv: string[]): Promise<void> {
  const overrides = setupOverrides(parseFlags(argv));
  const root = process.cwd();
  const adapter = pickAdapter(root);
  const plan = await planSetup({ root, git: gitIn(root), portFile: adapter.portFile, overrides });
  const values = await adapter.provision(plan);
  adapter.writeEnv(values);
  console.log(
    `  ✓ env files written${plan.name === null ? "" : `, app on http://localhost:${plan.port}`}\n`,
  );
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (command === "setup") return setup(rest);
  throw new UsageError(USAGE);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n\x1b[1;31m${message.replace(/^/gm, "  ")}\x1b[0m\n`);
  process.exit(error instanceof UsageError ? 2 : 1);
}
