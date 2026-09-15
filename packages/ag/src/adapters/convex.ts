// Convex adapter: one dev deployment per environment, selected or created
// through the project's own `convex` CLI, whose login is the credential.
// The deployment is `<team>:<project>:dev/agent/<name>`. A failed select
// means the deployment does not exist yet or expired, so create replaces it.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { delimiter, join } from "node:path";
import type { Adapter } from "../adapter.ts";
import { CONFIG_FILE } from "../config.ts";
import { parseEnvFile, upsertEnvFile } from "../env-file.ts";
import type { AgConfig, ConvexConfig, ConvexExpiration } from "../index.ts";

function convexConfig(config: AgConfig): ConvexConfig {
  const convex = config.convex;
  if (!convex?.apiDir || !convex.team || !convex.project) {
    throw new Error(
      `${CONFIG_FILE}: the convex adapter needs convex.apiDir, convex.team and convex.project`,
    );
  }
  return convex;
}

// A worktree environment is temporary; without an expiration Convex keeps
// a dev deployment forever.
export const DEFAULT_EXPIRATION: ConvexExpiration = "in 5 days";

export function convexAdapter(input: { root: string; config: AgConfig }): Adapter {
  const { root, config } = input;

  return {
    async setup(name: string): Promise<void> {
      const {
        team,
        project,
        apiDir: apiDirRelative,
        expiration,
        env,
        files,
      } = convexConfig(config);
      const apiDir = join(root, apiDirRelative);
      // bun links a bin into the .bin of the package that declares the
      // dependency, and hoists nothing to the root. Both entries are here
      // because a project may declare `convex` in the api package or at the root.
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
        if (result.status !== 0)
          throw new Error(`convex ${args.join(" ")} failed (exit ${result.status})`);
        return result;
      }

      const selector = `${team}:${project}:dev/agent/${name}`;
      console.log(`\n  Deployment: ${selector}`);
      if (convex(["deployment", "select", selector]).status !== 0) {
        console.log("  · not found, creating");
        convexOrFail([
          "deployment",
          "create",
          selector,
          "--type",
          "dev",
          "--select",
          "--expiration",
          String(expiration ?? DEFAULT_EXPIRATION),
        ]);
      }

      const url = parseEnvFile(join(apiDir, ".env.local")).CONVEX_URL;
      if (!url)
        throw new Error(`${apiDirRelative}/.env.local has no CONVEX_URL after the selection`);

      const present = new Set(
        convexOrFail(["env", "list", "--names-only"], true)
          .stdout.split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      );
      const wanted = env?.({ secret: () => randomBytes(32).toString("base64") }) ?? {};
      for (const [key, value] of Object.entries(wanted)) {
        if (present.has(key)) continue;
        console.log(`  · setting ${key}`);
        convexOrFail(["env", "set", key, value]);
      }

      convexOrFail(["dev", "--once"]);

      for (const [path, values] of Object.entries(files?.({ url }) ?? {})) {
        upsertEnvFile(join(root, path), values);
      }
      console.log(`  ✓ ${selector} is selected, pushed, and in the env files\n`);
    },
  };
}
