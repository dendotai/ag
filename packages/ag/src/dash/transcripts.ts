import { readdir } from "node:fs/promises";
import { join } from "node:path";

// Claude Code keeps a session's transcript under
// ~/.claude/projects/<slug>/<session-id>.jsonl, where the slug is the
// session's cwd with every character that is not a letter or a digit
// replaced by "-".
export const transcriptPrefix = (root: string): string =>
  `${root.replace(/[^a-zA-Z0-9]/g, "-")}--claude-worktrees-`;

export type TicketRef = { root: string; ticket: number };

// Full session id → the repo and ticket whose worktree the session ran in. A
// finished background session reports the main checkout as cwd, so the
// transcript location is the only record of its worktree. Async, because the
// dashboard reads it on every local poll and must not block its own server.
export async function readSessionTickets(
  projectsDir: string,
  roots: string[],
): Promise<Map<string, TicketRef>> {
  const map = new Map<string, TicketRef>();
  const dirs = await readdir(projectsDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    dirs.map(async (d) => {
      if (!d.isDirectory()) return;
      for (const root of roots) {
        const prefix = transcriptPrefix(root);
        if (!d.name.startsWith(prefix)) continue;
        const ticket = Number(/^(\d+)-/.exec(d.name.slice(prefix.length))?.[1]);
        if (!Number.isInteger(ticket)) continue;
        const files = await readdir(join(projectsDir, d.name)).catch(() => []);
        for (const f of files) {
          if (f.endsWith(".jsonl")) map.set(f.slice(0, -6), { root, ticket });
        }
      }
    }),
  );
  return map;
}
