// End-to-end: `ag worktree setup` in a real git repository with worktrees,
// against the fake convex. Asserts the commands issued, the files written,
// and idempotence.

import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  callsNamed,
  envValue,
  makeProject,
  type Project,
  readEnv,
} from "../test/convex-project.ts";

const CLI = join(import.meta.dir, "cli.ts");
const gitConfig = join(mkdtempSync(join(tmpdir(), "ag-gitconfig-")), "config");
writeFileSync(gitConfig, "[user]\n\tname = Ada\n\temail = ada@example.com\n");
const env = { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: "1" };

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
}

interface Repo extends Project {
  addWorktree(name: string): string;
}

function withRepo(fn: (repo: Repo) => void) {
  const project = makeProject();
  try {
    git(project.root, "init", "-q");
    git(project.root, "add", "-A");
    git(project.root, "commit", "-q", "-m", "Copy template");
    fn({
      ...project,
      addWorktree(name) {
        const path = join(project.dir, name);
        git(project.root, "worktree", "add", "-q", "-b", name, path);
        // node_modules is ignored, so the worktree links the main checkout's bin.
        mkdirSync(join(path, "node_modules"));
        execFileSync("ln", [
          "-s",
          join(project.root, "node_modules/.bin"),
          join(path, "node_modules/.bin"),
        ]);
        return path;
      },
    });
  } finally {
    project.cleanup();
  }
}

function run(cwd: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
const setup = (cwd: string, ...flags: string[]) => run(cwd, "worktree", "setup", ...flags);

const ENV_FILES = ["apps/web/.dev.vars", "apps/web/.env.local", "packages/api/.env.local"];

describe("ag worktree setup in a worktree", () => {
  test("creates an expiring deployment, stores the declared values, pushes once, writes the files", () => {
    withRepo((repo) => {
      const wt = repo.addWorktree("impl-87");

      expect(setup(wt).status).toBe(0);

      const calls = repo.calls();
      expect(callsNamed(calls, "deployment", "create")).toEqual([
        [
          "deployment",
          "create",
          "acme:acme-com:dev/agent/impl-87",
          "--type",
          "dev",
          "--select",
          "--expiration",
          "in 14 days",
        ],
      ]);
      expect(
        callsNamed(calls, "env", "set")
          .map((args) => args[2])
          .sort(),
      ).toEqual(["APP_SECRET", "MODE"]);
      expect(callsNamed(calls, "dev", "--once")).toHaveLength(1);
      // The push comes after every value is stored, and the files come after the push.
      expect(calls.at(-1)).toEqual(["dev", "--once"]);

      const url = `https://${repo.deployment().name}.convex.cloud`;
      expect(envValue(readEnv(wt, "apps/web/.env.local"), "VITE_BACKEND_URL")).toBe(url);
      expect(envValue(readEnv(wt, "apps/web/.dev.vars"), "BACKEND_URL")).toBe(url);
      expect(envValue(readEnv(wt, "packages/api/.env.local"), "CONVEX_DEPLOYMENT")).toContain(
        `dev:${repo.deployment().name}`,
      );
      expect(existsSync(join(repo.root, "apps/web/.dev.vars"))).toBe(false);
    });
  });

  test("a rerun changes nothing", () => {
    withRepo((repo) => {
      const wt = repo.addWorktree("impl-87");
      expect(setup(wt).status).toBe(0);
      const before = ENV_FILES.map((path) => readEnv(wt, path));
      const secret = repo.deployment().vars.APP_SECRET;
      repo.clearCalls();

      expect(setup(wt).status).toBe(0);

      const calls = repo.calls();
      expect(callsNamed(calls, "deployment", "select")).toEqual([
        ["deployment", "select", "acme:acme-com:dev/agent/impl-87"],
      ]);
      expect(callsNamed(calls, "deployment", "create")).toEqual([]);
      expect(callsNamed(calls, "env", "set")).toEqual([]);
      expect(repo.deployment().vars.APP_SECRET).toBe(secret);
      expect(ENV_FILES.map((path) => readEnv(wt, path))).toEqual(before);
    });
  });

  test("after the deployment expired, a rerun creates a new one and rewrites the files", () => {
    withRepo((repo) => {
      const wt = repo.addWorktree("impl-87");
      expect(setup(wt).status).toBe(0);
      const oldUrl = envValue(readEnv(wt, "apps/web/.dev.vars"), "BACKEND_URL");
      repo.expire("dev/agent/impl-87");
      repo.clearCalls();

      expect(setup(wt).status).toBe(0);

      expect(callsNamed(repo.calls(), "deployment", "create")).toHaveLength(1);
      const url = `https://${repo.deployment().name}.convex.cloud`;
      expect(url).not.toBe(oldUrl);
      expect(envValue(readEnv(wt, "apps/web/.dev.vars"), "BACKEND_URL")).toBe(url);
      expect(envValue(readEnv(wt, "apps/web/.env.local"), "VITE_BACKEND_URL")).toBe(url);
    });
  });

  test("the folder name goes to convex as is; convex's own error is the guard", () => {
    withRepo((repo) => {
      const wt = repo.addWorktree("Review_v2");
      const { status, stderr } = setup(wt);
      expect(status).toBe(1);
      expect(stderr).toContain("invalid reference dev/agent/Review_v2");
      expect(repo.deployments()).toEqual([]);
    });
  });
});

describe("ag worktree setup in the main checkout", () => {
  test("refuses, before any convex call", () => {
    withRepo((repo) => {
      const { status, stderr } = setup(repo.root);
      expect(status).toBe(1);
      expect(stderr).toContain("not a git worktree");
      expect(repo.calls()).toEqual([]);
    });
  });
});

describe("ag worktree setup flags and failures", () => {
  test("--expires never creates with no expiration", () => {
    withRepo((repo) => {
      const wt = repo.addWorktree("impl-87");
      expect(setup(wt, "--expires", "never").status).toBe(0);
      expect(repo.deployment().expiration).toBe("none");
    });
  });

  test("rejects a bad flag before any convex call", () => {
    withRepo((repo) => {
      const wt = repo.addWorktree("impl-87");
      expect(setup(wt, "--expires", "soon").status).toBe(2);
      expect(setup(wt, "--name", "x").status).toBe(2);
      expect(setup(wt, "--port", "3001").status).toBe(2);
      expect(repo.calls()).toEqual([]);
    });
  });

  test("stops at a failed create: no push, no files", () => {
    withRepo((repo) => {
      const wt = repo.addWorktree("impl-87");
      repo.refuseCreate();
      expect(setup(wt).status).toBe(1);
      expect(callsNamed(repo.calls(), "dev", "--once")).toEqual([]);
      expect(existsSync(join(wt, "apps/web/.dev.vars"))).toBe(false);
    });
  });

  test("names ag.config.ts when it is missing", () => {
    withRepo((repo) => {
      const wt = repo.addWorktree("impl-87");
      rmSync(join(wt, "ag.config.ts"));
      const { status, stderr } = setup(wt);
      expect(status).toBe(1);
      expect(stderr).toContain("ag.config.ts");
    });
  });

  test("prints usage for an unknown command", () => {
    withRepo((repo) => {
      const result = run(repo.root, "frobnicate");
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("usage");
    });
  });
});
