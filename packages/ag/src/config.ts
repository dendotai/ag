// `ag.config.ts` at the project root is the only thing ag knows about a
// project. Without it, ag does not guess.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AgConfig } from "./index.ts";

export const CONFIG_FILE = "ag.config.ts";

export async function loadConfig(root: string): Promise<AgConfig> {
  const path = join(root, CONFIG_FILE);
  if (!existsSync(path)) {
    throw new Error(
      `${CONFIG_FILE} not found in ${root}. ag reads its project settings from that file.`,
    );
  }
  const module = (await import(pathToFileURL(path).href)) as { default?: AgConfig };
  if (module.default === undefined) throw new Error(`${CONFIG_FILE} has no default export`);
  return module.default;
}
