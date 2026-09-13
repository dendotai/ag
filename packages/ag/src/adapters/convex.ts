// Convex adapter: one dev deployment per environment, selected or created
// through the project's own `convex` CLI, whose login is the credential.
//
// What one provision does, in order:
//   1. `convex deployment select`; when that fails (no such deployment yet,
//      or it expired) `convex deployment create --select`. Either way the
//      API package's `.env.local` now names it.
//   2. Set the values the first push needs and that the deployment lacks: a
//      generated BETTER_AUTH_SECRET, SITE_URL=http://localhost:<port>, and
//      placeholder Google client values. Values already set are never touched.
//   3. `convex dev --once`: one push, so the deployment matches the checkout.
//
// The isolated form is `<team>:<project>:dev/agent/<name>`; the developer's
// own environment is the project's personal dev deployment.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { delimiter, join, relative } from "node:path";
import type { Adapter } from "../adapter.ts";
import { type EnvValues, parseEnvFile, type SetupPlan, upsertEnvFile } from "../worktree.ts";

const PLACEHOLDER_SLUGS = { team: "your-convex-team", project: "your-convex-project" };
const GOOGLE_PLACEHOLDER = "placeholder";
const WEB_DIR = "apps/web";

// Convex references allow only lowercase letters, digits, `-` and `/`.
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readSlugs(root: string, apiDir: string): { team: string; project: string } {
  const file = relative(root, join(apiDir, "package.json"));
  const pkg = JSON.parse(readFileSync(join(apiDir, "package.json"), "utf8")) as {
    convex?: { team?: unknown; project?: unknown };
  };
  const team = pkg.convex?.team;
  const project = pkg.convex?.project;
  if (typeof team !== "string" || typeof project !== "string") {
    throw new Error(
      `${file} has no convex.team / convex.project: the Convex team and project slugs.`,
    );
  }
  if (team === PLACEHOLDER_SLUGS.team || project === PLACEHOLDER_SLUGS.project) {
    throw new Error(
      `${file} still has the template's convex.team / convex.project placeholders.\n` +
        "Put your Convex team and project slugs there.",
    );
  }
  return { team, project };
}

export function convexAdapter(input: { root: string; apiDir: string }): Adapter {
  const { root, apiDir } = input;
  const binDirs = [join(root, "node_modules/.bin"), join(apiDir, "node_modules/.bin")];

  function convex(args: string[], capture = false) {
    const result = spawnSync("convex", args, {
      cwd: apiDir,
      env: { ...process.env, PATH: [...binDirs, process.env.PATH ?? ""].join(delimiter) },
      encoding: "utf8",
      stdio: ["inherit", capture ? "pipe" : "inherit", "inherit"],
    });
    if (result.error) throw new Error(`could not run convex: ${result.error.message}`);
    return result;
  }

  function convexOrFail(args: string[], capture = false) {
    const result = convex(args, capture);
    if (result.status !== 0) {
      throw new Error(`convex ${args.join(" ")} failed (exit ${result.status})`);
    }
    return result;
  }

  return {
    name: "convex",
    apiDir,
    portFile: `${WEB_DIR}/.env.local`,

    async provision(plan: SetupPlan): Promise<EnvValues> {
      const { team, project } = readSlugs(root, apiDir);
      const isolated = plan.name !== null;
      const selector =
        plan.name === null
          ? `${team}:${project}:dev`
          : `${team}:${project}:dev/agent/${slugify(plan.name)}`;
      const expiration = plan.expires === null ? "none" : `in ${plan.expires} days`;

      console.log(`\n  Deployment: ${selector}`);
      if (convex(["deployment", "select", selector]).status !== 0) {
        console.log("  · not found, creating");
        const createArgs = isolated
          ? [selector, "--type", "dev", "--select", "--expiration", expiration]
          : [
              `${team}:${project}:dev/${slugify(userInfo().username)}`,
              "--type",
              "dev",
              "--default",
              "--select",
              ...(plan.expires === null ? [] : ["--expiration", expiration]),
            ];
        convexOrFail(["deployment", "create", ...createArgs]);
      }

      const url = parseEnvFile(join(apiDir, ".env.local")).CONVEX_URL;
      if (!url) {
        throw new Error(
          `${relative(root, apiDir)}/.env.local has no CONVEX_URL after the selection`,
        );
      }

      const present = new Set(
        convexOrFail(["env", "list", "--names-only"], true)
          .stdout.split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      );
      const wanted: Record<string, () => string> = {
        BETTER_AUTH_SECRET: () => randomBytes(32).toString("base64"),
        SITE_URL: () => `http://localhost:${plan.port}`,
        GOOGLE_CLIENT_ID: () => GOOGLE_PLACEHOLDER,
        GOOGLE_CLIENT_SECRET: () => GOOGLE_PLACEHOLDER,
      };
      for (const [key, value] of Object.entries(wanted)) {
        if (present.has(key)) continue;
        console.log(`  · setting ${key}`);
        convexOrFail(["env", "set", key, value()]);
      }

      convexOrFail(["dev", "--once"]);
      console.log(`  ✓ ${selector} is selected and pushed`);
      return { CONVEX_URL: url, ...(isolated ? { PORT: String(plan.port) } : {}) };
    },

    writeEnv(values: EnvValues): void {
      const { CONVEX_URL, PORT } = values;
      if (CONVEX_URL === undefined) throw new Error("writeEnv needs CONVEX_URL");
      upsertEnvFile(join(root, WEB_DIR, ".dev.vars"), { CONVEX_URL });
      upsertEnvFile(join(root, WEB_DIR, ".env.local"), {
        ...(PORT === undefined ? {} : { PORT }),
        VITE_CONVEX_URL: CONVEX_URL,
      });
    },

    teardown(): Promise<void> {
      return Promise.reject(new Error("teardown is not implemented yet: see ag sweep"));
    },
  };
}
