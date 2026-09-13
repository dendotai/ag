import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pickAdapter } from "./adapter.ts";

function withProject(rootPkg: object, dirs: string[], fn: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "ag-adapter-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify(rootPkg));
    for (const dir of dirs) mkdirSync(join(root, dir), { recursive: true });
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("pickAdapter", () => {
  test("picks convex when a workspace holds a convex/ directory", () => {
    withProject(
      { workspaces: ["apps/*", "packages/*"] },
      ["apps/web", "packages/api/convex", "packages/ui"],
      (root) => {
        const adapter = pickAdapter(root);
        expect(adapter.name).toBe("convex");
        expect(adapter.apiDir).toBe(join(root, "packages/api"));
      },
    );
  });

  test("reads the object form of workspaces", () => {
    withProject({ workspaces: { packages: ["packages/*"] } }, ["packages/api/convex"], (root) => {
      expect(pickAdapter(root).apiDir).toBe(join(root, "packages/api"));
    });
  });

  test("fails with a plain message when no workspace holds convex/", () => {
    withProject({ workspaces: ["packages/*"] }, ["packages/api"], (root) => {
      expect(() => pickAdapter(root)).toThrow("no adapter");
    });
  });
});
