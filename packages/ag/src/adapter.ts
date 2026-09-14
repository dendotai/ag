// The contract between the engine and a stack adapter. The engine decides the
// environment's name and lifetime; the adapter makes the environment exist
// and knows nothing about worktrees.

import { convexAdapter } from "./adapters/convex.ts";
import type { AgConfig } from "./config.ts";
import type { SetupPlan } from "./worktree.ts";

export interface Adapter {
  /** Creates or reuses the environment, stores the project's declared values, pushes, writes the env files. */
  setup(plan: SetupPlan): Promise<void>;
}

export function pickAdapter(root: string, config: AgConfig): Adapter {
  switch (config.adapter) {
    case "convex":
      return convexAdapter({ root, config });
    default:
      throw new Error(`ag.config.ts: unknown adapter "${config.adapter}"`);
  }
}
