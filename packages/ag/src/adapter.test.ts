import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inTempDir } from "../test/temp-dir.ts";
import { pickAdapter } from "./adapter.ts";

function withProject(rootPkg: object, dirs: string[], fn: (root: string) => void) {
  return inTempDir((root) => {
    writeFileSync(join(root, "package.json"), JSON.stringify(rootPkg));
    for (const dir of dirs) mkdirSync(join(root, dir), { recursive: true });
    fn(root);
  });
}

describe("pickAdapter", () => {
  test("picks convex when a workspace holds a convex/ directory", () =>
    withProject(
      { workspaces: ["apps/*", "packages/*"] },
      ["apps/web", "packages/api/convex", "packages/ui"],
      (root) => {
        expect(pickAdapter(root).name).toBe("convex");
      },
    ));

  test("reads the object form of workspaces", () =>
    withProject({ workspaces: { packages: ["packages/*"] } }, ["packages/api/convex"], (root) => {
      expect(pickAdapter(root).name).toBe("convex");
    }));

  test("fails with a plain message when no workspace holds convex/", () =>
    withProject({ workspaces: ["packages/*"] }, ["packages/api"], (root) => {
      expect(() => pickAdapter(root)).toThrow("no adapter");
    }));
});
