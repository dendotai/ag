import { readdirSync } from "node:fs";
import { join } from "node:path";

// Claude Code keeps a session's transcript under
// ~/.claude/projects/<slug>/<session-id>.jsonl, where the slug is the
// session's cwd with "/" and "_" replaced by "-".
export const transcriptPrefix = (root: string): string =>
  `${root.replace(/[/_]/g, "-")}--claude-worktrees-`;

export type TicketRef = { root: string; ticket: number };

// Full session id → the repo and ticket whose worktree the session ran in. A
// finished background session reports the main checkout as cwd, so the
// transcript location is the only record of its worktree.
export function readSessionTickets(projectsDir: string, roots: string[]): Map<string, TicketRef> {
  const map = new Map<string, TicketRef>();
  let dirs: { name: string; isDirectory(): boolean }[];
  try {
    dirs = readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return map;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    for (const root of roots) {
      const prefix = transcriptPrefix(root);
      if (!d.name.startsWith(prefix)) continue;
      const ticket = Number(/^(\d+)-/.exec(d.name.slice(prefix.length))?.[1]);
      if (!Number.isInteger(ticket)) continue;
      for (const f of readdirSync(join(projectsDir, d.name))) {
        if (f.endsWith(".jsonl")) map.set(f.slice(0, -6), { root, ticket });
      }
    }
  }
  return map;
}
