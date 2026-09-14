import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Git, isWorktree, parseEnvFile, planSetup, upsertEnvFile } from "./worktree.ts";

function withDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "ag-worktree-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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

describe("upsertEnvFile", () => {
  test("creates the file with one line per entry", () =>
    withDir((dir) => {
      const path = join(dir, ".env.local");
      upsertEnvFile(path, { PORT: "3001", VITE_URL: "https://x.convex.cloud" });
      expect(readFileSync(path, "utf8")).toBe("PORT=3001\nVITE_URL=https://x.convex.cloud\n");
    }));

  test("replaces the line of a key that exists and keeps every other line", () =>
    withDir((dir) => {
      const path = join(dir, ".dev.vars");
      writeFileSync(path, "# keep this comment\nURL=old\nCLOUDFLARE_API_TOKEN=keep-me");
      upsertEnvFile(path, { URL: "new", EXTRA: "1" });
      expect(readFileSync(path, "utf8")).toBe(
        "# keep this comment\nURL=new\nCLOUDFLARE_API_TOKEN=keep-me\nEXTRA=1\n",
      );
    }));
});

describe("parseEnvFile", () => {
  test("returns an empty map for a missing file", () =>
    withDir((dir) => {
      expect(parseEnvFile(join(dir, "nope"))).toEqual({});
    }));

  test("reads KEY=value lines and skips the rest", () =>
    withDir((dir) => {
      const path = join(dir, ".env.local");
      writeFileSync(path, "# c\nURL=https://x\nEMPTY=\nnot a line\n");
      expect(parseEnvFile(path)).toEqual({ URL: "https://x", EMPTY: "" });
    }));
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

describe("planSetup", () => {
  test("worktree: named after the directory, 14 days", () =>
    withDir((dir) => {
      const root = join(dir, "impl-3");
      mkdirSync(root);
      expect(planSetup({ root, git: worktreeGit })).toEqual({ name: "impl-3", expires: 14 });
    }));

  test("main checkout: refuses, and names --name as the way through", () => {
    expect(() => planSetup({ root: "/repo/main", git: mainGit })).toThrow("--name");
  });

  test("--name forces the worktree form in the main checkout", () => {
    const plan = planSetup({ root: "/repo/main", git: mainGit, overrides: { name: "review-1" } });
    expect(plan).toEqual({ name: "review-1", expires: 14 });
  });

  test("--expires overrides the lifetime, including no expiration", () =>
    withDir((dir) => {
      const root = join(dir, "impl-3");
      mkdirSync(root);
      expect(planSetup({ root, git: worktreeGit, overrides: { expires: 3 } }).expires).toBe(3);
      expect(
        planSetup({ root, git: worktreeGit, overrides: { expires: null } }).expires,
      ).toBeNull();
    }));
});
