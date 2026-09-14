// The adapter seam alone: what the config's `env` and `files` functions do.
// The commands issued and the files written end to end are in cli.test.ts.

import { describe, expect, test } from "bun:test";
import { callsNamed, envValue, readEnv, withProject } from "../../test/convex-project.ts";
import type { AgConfig } from "../config.ts";
import { convexAdapter } from "./convex.ts";

const base: AgConfig = {
  adapter: "convex",
  convex: { apiDir: "packages/api", team: "acme", project: "acme-com" },
};
const plan = { name: "impl-87", expires: 14 };

describe("convex adapter", () => {
  test("stores each declared value the deployment lacks, and never a present one", () =>
    withProject(async (project) => {
      const config: AgConfig = {
        ...base,
        env: ({ secret }) => ({ APP_SECRET: secret(), MODE: "dev", REGION: "eu" }),
      };
      await convexAdapter({ root: project.root, config }).setup(plan);
      const first = project.deployment().vars;
      expect(Object.keys(first).sort()).toEqual(["APP_SECRET", "MODE", "REGION"]);
      expect(first.APP_SECRET?.length).toBeGreaterThanOrEqual(32);

      project.setVars({ APP_SECRET: "mine", MODE: "dev" });
      project.clearCalls();
      await convexAdapter({ root: project.root, config }).setup(plan);

      expect(callsNamed(project.calls(), "env", "set").map((args) => args[2])).toEqual(["REGION"]);
      expect(project.deployment().vars.APP_SECRET).toBe("mine");
    }));

  test("writes the files the config declares, from the deployment's URL, keeping other lines", () =>
    withProject(async (project) => {
      const config: AgConfig = {
        ...base,
        files: ({ url }) => ({ "apps/web/.env": { BACKEND: url }, "notes.env": { ALSO: url } }),
      };
      await convexAdapter({ root: project.root, config }).setup(plan);
      const url = `https://${project.deployment().name}.convex.cloud`;
      expect(envValue(readEnv(project.root, "apps/web/.env"), "BACKEND")).toBe(url);
      expect(envValue(readEnv(project.root, "notes.env"), "ALSO")).toBe(url);
    }));

  test("a config without env and files stores nothing and writes nothing", () =>
    withProject(async (project) => {
      await convexAdapter({ root: project.root, config: base }).setup(plan);
      expect(callsNamed(project.calls(), "env", "set")).toEqual([]);
      expect(project.deployment().vars).toEqual({});
    }));

  test("fails before any convex call when the convex section is incomplete", () =>
    withProject(async (project) => {
      const config: AgConfig = {
        adapter: "convex",
        convex: { apiDir: "packages/api", team: "", project: "" },
      };
      await expect(convexAdapter({ root: project.root, config }).setup(plan)).rejects.toThrow(
        "convex.team",
      );
      expect(project.calls()).toEqual([]);
    }));
});
