// End-to-end: `ag setup` in a real git repository with worktrees, against the
// fake convex. Asserts the commands issued, the files written, and idempotence.

import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  callsNamed,
  envValue,
  makeProject,
  type Project,
  REQUIRED_VARS,
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

function setup(cwd: string, ...flags: string[]) {
  const result = spawnSync(process.execPath, [CLI, "setup", ...flags], {
    cwd,
    env,
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const ENV_FILES = ["apps/web/.dev.vars", "apps/web/.env.local", "packages/api/.env.local"];

describe("ag setup in a worktree", () => {
  test("creates an expiring environment, pushes once, writes both env files", () => {
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
      expect(callsNamed(calls, "dev", "--once")).toHaveLength(1);
      const [deployment] = repo.deployments();
      if (!deployment) throw new Error("no deployment");
      expect(Object.keys(deployment.vars).sort()).toEqual([...REQUIRED_VARS].sort());

      const envLocal = readEnv(wt, "apps/web/.env.local");
      const port = Number(envValue(envLocal, "PORT"));
      expect(port).toBeGreaterThanOrEqual(3001);
      expect(port).toBeLessThanOrEqual(3099);
      expect(deployment.vars.SITE_URL).toBe(`http://localhost:${port}`);
      const url = `https://${deployment.name}.convex.cloud`;
      expect(envValue(envLocal, "VITE_CONVEX_URL")).toBe(url);
      expect(envValue(readEnv(wt, "apps/web/.dev.vars"), "CONVEX_URL")).toBe(url);
      expect(envValue(readEnv(wt, "packages/api/.env.local"), "CONVEX_DEPLOYMENT")).toContain(
        `dev:${deployment.name}`,
      );
      expect(existsSync(join(repo.root, "apps/web/.dev.vars"))).toBe(false);
    });
  });

  test("a rerun changes nothing", () => {
    withRepo((repo) => {
      const wt = repo.addWorktree("impl-87");
      expect(setup(wt).status).toBe(0);
      const before = ENV_FILES.map((path) => readEnv(wt, path));
      const secret = repo.deployments()[0]?.vars.BETTER_AUTH_SECRET;
      repo.clearCalls();

      expect(setup(wt).status).toBe(0);

      const calls = repo.calls();
      expect(callsNamed(calls, "deployment", "select")).toEqual([
        ["deployment", "select", "acme:acme-com:dev/agent/impl-87"],
      ]);
      expect(callsNamed(calls, "deployment", "create")).toEqual([]);
      expect(callsNamed(calls, "env", "set")).toEqual([]);
      expect(repo.deployments()).toHaveLength(1);
      expect(repo.deployments()[0]?.vars.BETTER_AUTH_SECRET).toBe(secret);
      expect(ENV_FILES.map((path) => readEnv(wt, path))).toEqual(before);
    });
  });

  test("after the environment expired, a rerun creates a new one and keeps the port", () => {
    withRepo((repo) => {
      const wt = repo.addWorktree("impl-87");
      expect(setup(wt).status).toBe(0);
      const port = envValue(readEnv(wt, "apps/web/.env.local"), "PORT");
      const oldUrl = envValue(readEnv(wt, "apps/web/.dev.vars"), "CONVEX_URL");
      repo.expire("dev/agent/impl-87");
      repo.clearCalls();

      expect(setup(wt).status).toBe(0);

      expect(callsNamed(repo.calls(), "deployment", "create")).toHaveLength(1);
      const [deployment] = repo.deployments();
      if (!deployment) throw new Error("no deployment");
      const envLocal = readEnv(wt, "apps/web/.env.local");
      const url = `https://${deployment.name}.convex.cloud`;
      expect(url).not.toBe(oldUrl);
      expect(envValue(readEnv(wt, "apps/web/.dev.vars"), "CONVEX_URL")).toBe(url);
      expect(envValue(envLocal, "VITE_CONVEX_URL")).toBe(url);
      expect(envValue(envLocal, "PORT")).toBe(port);
    });
  });

  test("never hands out a port a sibling worktree holds", () => {
    withRepo((repo) => {
      const first = repo.addWorktree("impl-1");
      mkdirSync(join(first, "apps/web"), { recursive: true });
      writeFileSync(join(first, "apps/web/.env.local"), "PORT=3001\n");
      const second = repo.addWorktree("impl-2");

      expect(setup(second).status).toBe(0);

      const port = Number(envValue(readEnv(second, "apps/web/.env.local"), "PORT"));
      expect(port).toBeGreaterThan(3001);
      expect(port).toBeLessThanOrEqual(3099);
    });
  });
});

describe("ag setup in the main checkout", () => {
  test("provisions the developer's own environment with no expiration and no PORT", () => {
    withRepo((repo) => {
      writeFileSync(
        join(repo.root, "apps/web/.dev.vars"),
        "CONVEX_URL=https://your-dev-deployment.convex.cloud\nCLOUDFLARE_API_TOKEN=keep-me\n",
      );

      expect(setup(repo.root).status).toBe(0);

      const [create] = callsNamed(repo.calls(), "deployment", "create");
      expect(create).toContain("--default");
      expect(create).not.toContain("--expiration");
      const [deployment] = repo.deployments();
      if (!deployment) throw new Error("no deployment");
      expect(deployment.vars.SITE_URL).toBe("http://localhost:3000");
      expect(envValue(readEnv(repo.root, "apps/web/.env.local"), "PORT")).toBeUndefined();
      const devVars = readEnv(repo.root, "apps/web/.dev.vars");
      expect(envValue(devVars, "CONVEX_URL")).toBe(`https://${deployment.name}.convex.cloud`);
      expect(envValue(devVars, "CLOUDFLARE_API_TOKEN")).toBe("keep-me");
    });
  });
});

describe("ag setup flags", () => {
  test("--name forces the worktree form; --port and --expires override the engine", () => {
    withRepo((repo) => {
      expect(
        setup(repo.root, "--name", "review-1", "--port", "4123", "--expires", "3").status,
      ).toBe(0);
      expect(callsNamed(repo.calls(), "deployment", "create")).toEqual([
        [
          "deployment",
          "create",
          "acme:acme-com:dev/agent/review-1",
          "--type",
          "dev",
          "--select",
          "--expiration",
          "in 3 days",
        ],
      ]);
      expect(repo.deployments()[0]?.vars.SITE_URL).toBe("http://localhost:4123");
      expect(envValue(readEnv(repo.root, "apps/web/.env.local"), "PORT")).toBe("4123");
    });
  });

  test("--expires never creates a worktree environment with no expiration", () => {
    withRepo((repo) => {
      const wt = repo.addWorktree("impl-87");
      expect(setup(wt, "--expires", "never").status).toBe(0);
      expect(callsNamed(repo.calls(), "deployment", "create")[0]).toContain("none");
    });
  });

  test("rejects a bad --expires or --port before any convex call", () => {
    withRepo((repo) => {
      expect(setup(repo.root, "--expires", "soon").status).toBe(2);
      expect(setup(repo.root, "--port", "abc").status).toBe(2);
      expect(repo.calls()).toEqual([]);
    });
  });
});

describe("ag setup refuses to guess", () => {
  test("fails before any convex call while the slugs are the template placeholders", () => {
    withRepo((repo) => {
      writeFileSync(
        join(repo.apiDir, "package.json"),
        '{\n  "name": "@acme/api",\n  "convex": { "team": "your-convex-team", "project": "your-convex-project" }\n}\n',
      );
      const { status, stderr } = setup(repo.root);
      expect(status).toBe(1);
      expect(stderr).toContain("packages/api/package.json");
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
      expect(existsSync(join(wt, "apps/web/.env.local"))).toBe(false);
    });
  });

  test("prints usage for an unknown command", () => {
    withRepo((repo) => {
      const result = spawnSync(process.execPath, [CLI, "frobnicate"], {
        cwd: repo.root,
        env,
        encoding: "utf8",
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("usage");
    });
  });
});
