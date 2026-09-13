// One dashboard row per ticket that has a worktree, a session, a state label
// or a pull request. Pure: every source is handed in.
import { readdirSync } from "node:fs";
import { join } from "node:path";

export type Session = { sessionId: string; status?: string | null; kind: string; cwd: string; startedAt: number };
export type Issue = { number: number; title: string; url: string; labels: { name: string }[] };
export type Pr = { number: number; isDraft: boolean; url: string; body: string | null; headRefName: string };
export type Worktree = { ticket: number; branch: string; ahead: number };

export type Sources = {
  repo: string;
  issues: Issue[];
  prs: Pr[];
  pushed: Set<string>;
  sessions: Session[];
  // Full session id → ticket, for finished sessions whose cwd no longer names
  // the worktree.
  sessionTickets: Map<string, number>;
  worktrees: Worktree[];
};

export type Verdict = "running" | "done" | "parked" | "stalled" | "idle";

export type Row = {
  ticket: number;
  title: string;
  issueUrl: string;
  stateLabels: string[];
  session: { id: string; status: "running" | "finished"; startedAt: number } | null;
  branch: { name: string; ahead: number; pushed: boolean } | null;
  pr: { number: number; draft: boolean; url: string } | null;
  verdict: Verdict;
};

const STATE_LABEL = /^(in-progress|in-review|needs-human|ready-for-agent)$/;
const BUSY_LABEL = /^(in-progress|in-review|needs-human)$/;

export const ticketOfPath = (path: string): number | undefined => {
  const m = /\/impl-(\d+)$/.exec(path);
  return m ? Number(m[1]) : undefined;
};

export function buildRows(s: Sources): Row[] {
  const rows = new Map<number, Row>();
  const row = (n: number): Row => {
    let r = rows.get(n);
    if (!r) {
      const issue = s.issues.find((i) => i.number === n);
      r = {
        ticket: n,
        title: issue?.title ?? "(closed or unknown)",
        issueUrl: issue?.url ?? `https://github.com/${s.repo}/issues/${n}`,
        stateLabels: issue?.labels.map((l) => l.name).filter((l) => STATE_LABEL.test(l)) ?? [],
        session: null,
        branch: null,
        pr: null,
        verdict: "idle",
      };
      rows.set(n, r);
    }
    return r;
  };

  for (const i of s.issues) {
    if (i.labels.some((l) => BUSY_LABEL.test(l.name))) row(i.number);
  }
  for (const sess of s.sessions) {
    if (sess.kind !== "background") continue;
    const n = s.sessionTickets.get(sess.sessionId) ?? ticketOfPath(sess.cwd);
    if (!n) continue;
    const r = row(n);
    // Keep the newest session of a ticket.
    if (!r.session || sess.startedAt > r.session.startedAt) {
      r.session = {
        id: sess.sessionId.slice(0, 8),
        status: sess.status === "busy" ? "running" : "finished",
        startedAt: sess.startedAt,
      };
    }
  }
  for (const wt of s.worktrees) {
    row(wt.ticket).branch = { name: wt.branch, ahead: wt.ahead, pushed: s.pushed.has(wt.branch) };
  }
  for (const p of s.prs) {
    const m = /closes\s+#(\d+)/i.exec(p.body ?? "");
    const n = m ? Number(m[1]) : [...rows.values()].find((r) => r.branch?.name === p.headRefName)?.ticket;
    if (!n) continue;
    row(n).pr = { number: p.number, draft: p.isDraft, url: p.url };
  }
  for (const r of rows.values()) {
    if (r.session?.status === "running") r.verdict = "running";
    else if (r.stateLabels.includes("needs-human")) r.verdict = "parked";
    else if (r.pr && !r.pr.draft) r.verdict = "done";
    else if (r.session?.status === "finished") r.verdict = "stalled";
  }
  // A closed ticket stays only while a session still runs or a PR is open.
  const open = new Set(s.issues.map((i) => i.number));
  return [...rows.values()]
    .filter((r) => open.has(r.ticket) || r.verdict === "running" || r.pr)
    .sort((a, b) => a.ticket - b.ticket);
}

export function parseWorktrees(porcelain: string): Map<number, { path: string; branch: string }> {
  const map = new Map<number, { path: string; branch: string }>();
  let path = "";
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice(9);
    else if (line.startsWith("branch ")) {
      const n = ticketOfPath(path);
      if (n) map.set(n, { path, branch: line.slice(7).replace(/^refs\/heads\//, "") });
    }
  }
  return map;
}

// Claude Code keeps a session's transcript under
// ~/.claude/projects/<slug>/<session-id>.jsonl, where the slug is the
// session's cwd with "/" and "_" replaced by "-".
export const transcriptPrefix = (root: string): string => `${root.replace(/[/_]/g, "-")}--claude-worktrees-impl-`;

export function sessionTickets(projectsDir: string, prefix: string): Map<string, number> {
  const map = new Map<string, number>();
  let dirs: string[];
  try {
    dirs = readdirSync(projectsDir);
  } catch {
    return map;
  }
  for (const d of dirs) {
    if (!d.startsWith(prefix)) continue;
    const n = Number(d.slice(prefix.length));
    if (!Number.isInteger(n)) continue;
    for (const f of readdirSync(join(projectsDir, d))) {
      if (f.endsWith(".jsonl")) map.set(f.slice(0, -6), n);
    }
  }
  return map;
}
