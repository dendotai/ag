// The contract between the engine and a stack adapter. The engine names the
// environment; the adapter makes it exist and knows nothing about worktrees.

import { convexAdapter } from "./adapters/convex.ts";
import type { AgConfig } from "./config.ts";

export interface Adapter {
  /** Creates or reuses the environment of that name and writes the project's env files. */
  setup(name: string): Promise<void>;
}

export function pickAdapter(root: string, config: AgConfig): Adapter {
  switch (config.adapter) {
    case "convex":
      return convexAdapter({ root, config });
    default:
      throw new Error(`ag.config.ts: unknown adapter "${config.adapter}"`);
  }
}
