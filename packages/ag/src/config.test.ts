import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withProject } from "../test/convex-project.ts";
import { loadConfig } from "./config.ts";

describe("loadConfig", () => {
  test("loads the default export of ag.config.ts", () =>
    withProject(async (project) => {
      const config = await loadConfig(project.root);
      expect(config.adapter).toBe("convex");
      expect(config.convex?.team).toBe("acme");
    }));

  test("fails with a message that names the file when it is missing", () =>
    withProject(async (project) => {
      rmSync(join(project.root, "ag.config.ts"));
      await expect(loadConfig(project.root)).rejects.toThrow("ag.config.ts");
    }));

  test("fails when the file has no default export", () =>
    withProject(async (project) => {
      writeFileSync(join(project.root, "ag.config.ts"), "export const x = 1;\n");
      await expect(loadConfig(project.root)).rejects.toThrow("default export");
    }));
});
