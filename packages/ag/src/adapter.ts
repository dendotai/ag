// The contract between the engine and a stack adapter. The engine decides
// name, port and lifetime; the adapter turns them into an environment and
// the project's env files, and knows nothing about worktrees.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { convexAdapter } from "./adapters/convex.ts";
import type { SetupPlan } from "./worktree.ts";

/** `Values` is the adapter's own shape; the engine only passes it from provision to writeEnv. */
export interface Adapter<Values = unknown> {
  name: string;
  /** Path, relative to the project root, of the env file that records PORT. */
  portFile: string;
  /** Creates or reuses the environment and returns the values the project's env files need. */
  provision(plan: SetupPlan): Promise<Values>;
  writeEnv(values: Values): void;
  /** Used by `ag sweep`. */
  teardown(name: string): Promise<void>;
}

function workspaceGlobs(root: string): string[] {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    workspaces?: string[] | { packages?: string[] };
  };
  const ws = pkg.workspaces;
  if (Array.isArray(ws)) return ws;
  return ws?.packages ?? [];
}

// Expands the `dir/*` form only; that is the form workspaces use.
function workspaceDirs(root: string): string[] {
  const dirs: string[] = [];
  for (const glob of workspaceGlobs(root)) {
    if (!glob.endsWith("/*")) {
      dirs.push(join(root, glob));
      continue;
    }
    const parent = join(root, glob.slice(0, -2));
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent)) {
      const dir = join(parent, entry);
      if (statSync(dir).isDirectory()) dirs.push(dir);
    }
  }
  return dirs;
}

// Picked by the project's files until a config file exists.
export function pickAdapter(root: string): Adapter {
  const apiDir = workspaceDirs(root).find((dir) => existsSync(join(dir, "convex")));
  if (apiDir === undefined) {
    throw new Error("no adapter matches this project: no workspace holds a convex/ directory");
  }
  return convexAdapter({ root, apiDir });
}
