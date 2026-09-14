// The worktree engine: is this checkout a git worktree, what is its name,
// how long does its environment live. Knows no stack.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

export type EnvValues = Record<string, string>;

export type Git = (args: string[]) => { status: number | null; stdout: string };

export function gitIn(cwd: string): Git {
  return (args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    return { status: result.error ? 128 : result.status, stdout: result.stdout ?? "" };
  };
}

// A linked worktree has its own git dir under the main checkout's `.git`;
// the main checkout's git dir and common dir are the same directory.
export function isWorktree(root: string, git: Git): boolean {
  const gitDir = git(["rev-parse", "--git-dir"]);
  const commonDir = git(["rev-parse", "--git-common-dir"]);
  if (gitDir.status !== 0 || commonDir.status !== 0) return false;
  return resolve(root, gitDir.stdout.trim()) !== resolve(root, commonDir.stdout.trim());
}

export function parseEnvFile(path: string): EnvValues {
  if (!existsSync(path)) return {};
  const out: EnvValues = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) out[match[1] as string] = match[2] as string;
  }
  return out;
}

// Replaces the line of each key that exists and appends the others, so the
// developer's own lines in the file survive.
export function upsertEnvFile(path: string, entries: EnvValues): void {
  let text = existsSync(path) ? readFileSync(path, "utf8") : "";
  for (const [key, value] of Object.entries(entries)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    if (pattern.test(text)) text = text.replace(pattern, line);
    else text += `${text.length === 0 || text.endsWith("\n") ? "" : "\n"}${line}\n`;
  }
  writeFileSync(path, text);
}

export const DEFAULT_LIFETIME_DAYS = 14;

export interface SetupOverrides {
  /** Forces the worktree form with this environment name, in any checkout. */
  name?: string;
  /** Lifetime in days; null means no expiration. */
  expires?: number | null;
}

export interface SetupPlan {
  name: string;
  /** Lifetime in days; null means no expiration. */
  expires: number | null;
}

export function planSetup(input: {
  root: string;
  git: Git;
  overrides?: SetupOverrides;
}): SetupPlan {
  const { root, git, overrides = {} } = input;
  const name = overrides.name ?? (isWorktree(root, git) ? basename(root) : undefined);
  if (name === undefined) {
    throw new Error(
      "not a git worktree. The main checkout is set up by hand; " +
        "pass --name to give this checkout a worktree environment anyway.",
    );
  }
  return {
    name,
    expires: overrides.expires === undefined ? DEFAULT_LIFETIME_DAYS : overrides.expires,
  };
}
