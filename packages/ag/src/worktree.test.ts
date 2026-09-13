import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Git,
  heldPorts,
  isWorktree,
  parseEnvFile,
  pickPort,
  planSetup,
  upsertEnvFile,
} from "./worktree.ts";

function withDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "ag-worktree-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function withDirAsync(fn: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "ag-worktree-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("upsertEnvFile", () => {
  test("creates the file with one line per entry", () => {
    withDir((dir) => {
      const path = join(dir, ".env.local");
      upsertEnvFile(path, { PORT: "3001", VITE_CONVEX_URL: "https://x.convex.cloud" });
      expect(readFileSync(path, "utf8")).toBe(
        "PORT=3001\nVITE_CONVEX_URL=https://x.convex.cloud\n",
      );
    });
  });

  test("replaces the line of a key that exists and keeps every other line", () => {
    withDir((dir) => {
      const path = join(dir, ".dev.vars");
      writeFileSync(path, "# keep this comment\nCONVEX_URL=old\nCLOUDFLARE_API_TOKEN=keep-me");
      upsertEnvFile(path, { CONVEX_URL: "new", EXTRA: "1" });
      expect(readFileSync(path, "utf8")).toBe(
        "# keep this comment\nCONVEX_URL=new\nCLOUDFLARE_API_TOKEN=keep-me\nEXTRA=1\n",
      );
    });
  });
});

describe("parseEnvFile", () => {
  test("returns an empty map for a missing file", () => {
    withDir((dir) => {
      expect(parseEnvFile(join(dir, "nope"))).toEqual({});
    });
  });

  test("reads KEY=value lines and drops trailing comments", () => {
    withDir((dir) => {
      const path = join(dir, ".env.local");
      writeFileSync(path, "# c\nPORT=3005 # chosen\nEMPTY=\nnot a line\n");
      expect(parseEnvFile(path)).toEqual({ PORT: "3005", EMPTY: "" });
    });
  });
});

// A git runner that answers from a table, so no git binary is needed.
function fakeGit(answers: Record<string, string>): Git {
  return (args) => {
    const key = args.join(" ");
    const stdout = answers[key];
    return stdout === undefined ? { status: 128, stdout: "" } : { status: 0, stdout };
  };
}

describe("isWorktree", () => {
  test("false when the git dir and the common dir are the same directory", () => {
    const git = fakeGit({
      "rev-parse --git-dir": ".git\n",
      "rev-parse --git-common-dir": ".git\n",
    });
    expect(isWorktree("/repo/main", git)).toBe(false);
  });

  test("true when the git dir lives under another checkout's .git", () => {
    const git = fakeGit({
      "rev-parse --git-dir": "/repo/main/.git/worktrees/impl-3\n",
      "rev-parse --git-common-dir": "/repo/main/.git\n",
    });
    expect(isWorktree("/repo/impl-3", git)).toBe(true);
  });

  test("false outside a git repository", () => {
    expect(isWorktree("/tmp/nowhere", fakeGit({}))).toBe(false);
  });
});

describe("heldPorts", () => {
  test("collects the PORT each sibling worktree holds in its port file, skipping this checkout", () => {
    withDir((dir) => {
      const here = join(dir, "here");
      const a = join(dir, "a");
      const b = join(dir, "b");
      const c = join(dir, "c");
      for (const d of [here, a, b, c]) mkdirSync(join(d, "apps/web"), { recursive: true });
      writeFileSync(join(here, "apps/web/.env.local"), "PORT=3001\n");
      writeFileSync(join(a, "apps/web/.env.local"), "PORT=3002\n");
      writeFileSync(join(b, "apps/web/.env.local"), "VITE_X=1\n");
      const git = fakeGit({
        "worktree list --porcelain": [here, a, b, c]
          .map((d) => `worktree ${d}\nHEAD abc\nbranch refs/heads/x\n`)
          .join("\n"),
      });
      expect(heldPorts(here, git, "apps/web/.env.local")).toEqual(new Set([3002]));
    });
  });

  test("is empty outside a git repository", () => {
    expect(heldPorts("/tmp/nowhere", fakeGit({}), ".env")).toEqual(new Set());
  });
});

describe("pickPort", () => {
  const free = async () => true;

  test("keeps a current port inside the band without scanning", async () => {
    expect(await pickPort(3042, new Set([3042]), free)).toBe(3042);
  });

  test("hands out the first band port no sibling holds and no socket uses", async () => {
    const busy = new Set([3001, 3002]);
    const isFree = async (port: number) => port !== 3003;
    expect(await pickPort(undefined, busy, isFree)).toBe(3004);
  });

  test("throws when the band is exhausted", async () => {
    const held = new Set(Array.from({ length: 99 }, (_, i) => 3001 + i));
    await expect(pickPort(undefined, held, free)).rejects.toThrow("no free port");
  });
});

describe("planSetup", () => {
  const free = async () => true;
  const mainGit = fakeGit({
    "rev-parse --git-dir": ".git\n",
    "rev-parse --git-common-dir": ".git\n",
    "worktree list --porcelain": "",
  });
  const worktreeGit = (root: string, siblings: string[] = []) =>
    fakeGit({
      "rev-parse --git-dir": "/main/.git/worktrees/x\n",
      "rev-parse --git-common-dir": "/main/.git\n",
      "worktree list --porcelain": [root, ...siblings].map((d) => `worktree ${d}\n`).join("\n"),
    });

  test("main checkout: own environment, the main port, no expiration", async () => {
    await withDirAsync(async (root) => {
      const plan = await planSetup({ root, git: mainGit, portFile: ".env", isFree: free });
      expect(plan).toEqual({ name: null, port: 3000, expires: null });
    });
  });

  test("worktree: named after the directory, a band port, 14 days", async () => {
    await withDirAsync(async (dir) => {
      const root = join(dir, "impl-3");
      mkdirSync(root);
      const plan = await planSetup({
        root,
        git: worktreeGit(root),
        portFile: ".env",
        isFree: free,
      });
      expect(plan).toEqual({ name: "impl-3", port: 3001, expires: 14 });
    });
  });

  test("worktree rerun keeps the port already in its port file", async () => {
    await withDirAsync(async (dir) => {
      const root = join(dir, "impl-3");
      mkdirSync(root);
      writeFileSync(join(root, ".env"), "PORT=3007\n");
      const plan = await planSetup({
        root,
        git: worktreeGit(root),
        portFile: ".env",
        isFree: free,
      });
      expect(plan.port).toBe(3007);
    });
  });

  test("worktree: never hands out a port a sibling holds", async () => {
    await withDirAsync(async (dir) => {
      const root = join(dir, "impl-3");
      const sibling = join(dir, "impl-2");
      mkdirSync(root);
      mkdirSync(sibling);
      writeFileSync(join(sibling, ".env"), "PORT=3001\n");
      const git = worktreeGit(root, [sibling]);
      const plan = await planSetup({ root, git, portFile: ".env", isFree: free });
      expect(plan.port).toBe(3002);
    });
  });

  test("--name forces the worktree form in the main checkout", async () => {
    await withDirAsync(async (root) => {
      const plan = await planSetup({
        root,
        git: mainGit,
        portFile: ".env",
        isFree: free,
        overrides: { name: "review-1" },
      });
      expect(plan).toEqual({ name: "review-1", port: 3001, expires: 14 });
    });
  });

  test("--port and --expires override the engine's decisions", async () => {
    await withDirAsync(async (dir) => {
      const root = join(dir, "impl-3");
      mkdirSync(root);
      const plan = await planSetup({
        root,
        git: worktreeGit(root),
        portFile: ".env",
        isFree: free,
        overrides: { port: 4123, expires: 3 },
      });
      expect(plan).toEqual({ name: "impl-3", port: 4123, expires: 3 });
      const forever = await planSetup({
        root,
        git: worktreeGit(root),
        portFile: ".env",
        isFree: free,
        overrides: { expires: null },
      });
      expect(forever.expires).toBeNull();
    });
  });
});
