// The worktree engine: is this checkout a git worktree, and what is its name.
// Knows no stack.

import { spawnSync } from "node:child_process";
import { basename, resolve } from "node:path";

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

/** The environment name: the worktree folder's name. Throws in the main checkout. */
export function worktreeName(root: string, git: Git): string {
  if (!isWorktree(root, git)) {
    throw new Error("not a git worktree. The main checkout is set up by hand.");
  }
  return basename(root);
}
