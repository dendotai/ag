import { describe, expect, test } from "bun:test";
import { type Git, isWorktree, worktreeName } from "./worktree.ts";

// A git runner that answers from a table, so no git binary is needed.
function fakeGit(answers: Record<string, string>): Git {
  return (args) => {
    const stdout = answers[args.join(" ")];
    return stdout === undefined ? { status: 128, stdout: "" } : { status: 0, stdout };
  };
}
const mainGit = fakeGit({
  "rev-parse --git-dir": ".git\n",
  "rev-parse --git-common-dir": ".git\n",
});
const worktreeGit = fakeGit({
  "rev-parse --git-dir": "/main/.git/worktrees/x\n",
  "rev-parse --git-common-dir": "/main/.git\n",
});

describe("isWorktree", () => {
  test("false when the git dir and the common dir are the same directory", () => {
    expect(isWorktree("/repo/main", mainGit)).toBe(false);
  });

  test("true when the git dir lives under another checkout's .git", () => {
    expect(isWorktree("/repo/impl-3", worktreeGit)).toBe(true);
  });

  test("false outside a git repository", () => {
    expect(isWorktree("/tmp/nowhere", fakeGit({}))).toBe(false);
  });
});

describe("worktreeName", () => {
  test("is the worktree folder's name", () => {
    expect(worktreeName("/repo/.claude/worktrees/69-short-title", worktreeGit)).toBe(
      "69-short-title",
    );
  });

  test("refuses the main checkout", () => {
    expect(() => worktreeName("/repo/main", mainGit)).toThrow("not a git worktree");
  });
});
