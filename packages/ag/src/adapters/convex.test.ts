import { describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  callsNamed,
  envValue,
  type Project,
  REQUIRED_VARS,
  readEnv,
  withProject,
} from "../../test/convex-project.ts";
import { convexAdapter } from "./convex.ts";

const adapterOf = (project: Project) =>
  convexAdapter({ root: project.root, apiDir: project.apiDir });

describe("convex adapter: an isolated environment", () => {
  test("creates a selected, expiring deployment, sets the four values, pushes, returns the values", async () => {
    await withProject(async (project) => {
      const values = await adapterOf(project).provision({
        name: "impl-87",
        port: 3005,
        expires: 14,
      });

      const calls = project.calls();
      expect(callsNamed(calls, "deployment", "select")).toEqual([
        ["deployment", "select", "acme:acme-com:dev/agent/impl-87"],
      ]);
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
      // The push comes last: every value is on the deployment by then.
      expect(calls.at(-1)).toEqual(["dev", "--once"]);

      const deployment = project.deployment();
      expect(Object.keys(deployment.vars).sort()).toEqual([...REQUIRED_VARS].sort());
      expect(deployment.vars.BETTER_AUTH_SECRET?.length).toBeGreaterThanOrEqual(32);
      expect(deployment.vars.SITE_URL).toBe("http://localhost:3005");
      expect(deployment.vars.GOOGLE_CLIENT_ID).toBe("placeholder");
      expect(deployment.vars.GOOGLE_CLIENT_SECRET).toBe("placeholder");
      expect(values).toEqual({
        CONVEX_URL: `https://${deployment.name}.convex.cloud`,
        PORT: "3005",
      });
      expect(existsSync(join(project.root, "apps/web/.env.local"))).toBe(false);
    });
  });

  test("a second provision keeps the deployment and sets nothing", async () => {
    await withProject(async (project) => {
      const plan = { name: "impl-87", port: 3005, expires: 14 };
      const first = await adapterOf(project).provision(plan);
      project.clearCalls();

      const second = await adapterOf(project).provision(plan);

      expect(second).toEqual(first);
      const calls = project.calls();
      expect(callsNamed(calls, "deployment", "create")).toEqual([]);
      expect(callsNamed(calls, "env", "set")).toEqual([]);
      expect(project.deployments()).toHaveLength(1);
    });
  });

  test("a lifetime of null creates with no expiration", async () => {
    await withProject(async (project) => {
      await adapterOf(project).provision({ name: "long-lived", port: 3005, expires: null });
      expect(project.deployments()[0]?.expiration).toBe("none");
    });
  });

  test("the reference is the name, lowercased and slug-safe", async () => {
    await withProject(async (project) => {
      await adapterOf(project).provision({ name: "Feature_Login.v2", port: 3005, expires: 14 });
      expect(callsNamed(project.calls(), "deployment", "create")[0]?.[2]).toBe(
        "acme:acme-com:dev/agent/feature-login-v2",
      );
    });
  });
});

describe("convex adapter: the developer's own environment", () => {
  test("creates the personal dev deployment without expiration and returns no PORT", async () => {
    await withProject(async (project) => {
      const values = await adapterOf(project).provision({ name: null, port: 3000, expires: null });

      const calls = project.calls();
      expect(callsNamed(calls, "deployment", "select")[0]).toEqual([
        "deployment",
        "select",
        "acme:acme-com:dev",
      ]);
      const [create] = callsNamed(calls, "deployment", "create");
      expect(create?.[2]).toMatch(/^acme:acme-com:dev\/[a-z0-9-]+$/);
      expect(create).toContain("--default");
      expect(create).toContain("--select");
      expect(create).not.toContain("--expiration");
      expect(calls.at(-1)).toEqual(["dev", "--once"]);

      const deployment = project.deployment();
      expect(deployment.isDefault).toBe(true);
      expect(deployment.vars.SITE_URL).toBe("http://localhost:3000");
      expect(values).toEqual({ CONVEX_URL: `https://${deployment.name}.convex.cloud` });
    });
  });

  test("sets only the values the deployment is missing", async () => {
    await withProject(async (project) => {
      const plan = { name: null, port: 3000, expires: null };
      await adapterOf(project).provision(plan);
      project.setVars({ SITE_URL: "https://dev.acme.com", BETTER_AUTH_SECRET: "real" });
      project.clearCalls();

      await adapterOf(project).provision(plan);

      const set = callsNamed(project.calls(), "env", "set").map((args) => args[2]);
      expect(set.sort()).toEqual(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
      expect(project.deployments()[0]?.vars.SITE_URL).toBe("https://dev.acme.com");
    });
  });
});

describe("convex adapter: writeEnv", () => {
  test("writes CONVEX_URL to .dev.vars and PORT + VITE_CONVEX_URL to .env.local, keeping other lines", () =>
    withProject((project) => {
      writeFileSync(
        join(project.root, "apps/web/.dev.vars"),
        "CONVEX_URL=https://old.convex.cloud\nCLOUDFLARE_API_TOKEN=keep-me\n",
      );
      adapterOf(project).writeEnv({ CONVEX_URL: "https://new.convex.cloud", PORT: "3005" });
      const devVars = readEnv(project.root, "apps/web/.dev.vars");
      expect(envValue(devVars, "CONVEX_URL")).toBe("https://new.convex.cloud");
      expect(envValue(devVars, "CLOUDFLARE_API_TOKEN")).toBe("keep-me");
      const envLocal = readEnv(project.root, "apps/web/.env.local");
      expect(envValue(envLocal, "PORT")).toBe("3005");
      expect(envValue(envLocal, "VITE_CONVEX_URL")).toBe("https://new.convex.cloud");
    }));

  test("writes no PORT line when the values carry none", () =>
    withProject((project) => {
      adapterOf(project).writeEnv({ CONVEX_URL: "https://new.convex.cloud" });
      expect(envValue(readEnv(project.root, "apps/web/.env.local"), "PORT")).toBeUndefined();
    }));
});

describe("convex adapter: refuses to guess", () => {
  test("fails before any convex call while the slugs are the template placeholders", async () => {
    await withProject(async (project) => {
      writeFileSync(
        join(project.apiDir, "package.json"),
        '{\n  "name": "@acme/api",\n  "convex": { "team": "your-convex-team", "project": "your-convex-project" }\n}\n',
      );
      await expect(
        adapterOf(project).provision({ name: null, port: 3000, expires: null }),
      ).rejects.toThrow("packages/api/package.json");
      expect(project.calls()).toEqual([]);
    });
  });

  test("fails when the slugs are absent", async () => {
    await withProject(async (project) => {
      writeFileSync(join(project.apiDir, "package.json"), '{\n  "name": "@acme/api"\n}\n');
      await expect(
        adapterOf(project).provision({ name: null, port: 3000, expires: null }),
      ).rejects.toThrow("convex.team");
      expect(project.calls()).toEqual([]);
    });
  });

  test("stops at a failed create: no push", async () => {
    await withProject(async (project) => {
      project.refuseCreate();
      await expect(
        adapterOf(project).provision({ name: "impl-87", port: 3005, expires: 14 }),
      ).rejects.toThrow("deployment create");
      expect(callsNamed(project.calls(), "dev", "--once")).toEqual([]);
    });
  });
});
