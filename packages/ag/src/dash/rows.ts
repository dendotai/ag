// Dashboard rows from the collected sources. One row per ticket that has a
// worktree, a session, a state label or a pull request in its repo; a session
// without a ticket (an interactive chat, other background work) gets a row of
// its own.
import { shortSessionId, ticketOfPath } from "../ticket.ts";
import type { TicketRef } from "./transcripts.ts";

export type Session = {
  sessionId: string;
  status?: string | null;
  kind: string;
  cwd: string;
  startedAt: number;
  name?: string;
};
export type Issue = { number: number; title: string; url: string; labels: { name: string }[] };
export type Pr = {
  number: number;
  isDraft: boolean;
  url: string;
  body: string | null;
  headRefName: string;
};
export type Repo = { root: string; name: string; issues: Issue[]; prs: Pr[]; pushed: Set<string> };
export type Worktree = { root: string; ticket: number; branch: string; ahead: number };

export type Sources = {
  home: string;
  repos: Repo[];
  sessions: Session[];
  // Session cwd → main checkout of the repo that holds it, null outside a repo.
  sessionRoots: Map<string, string | null>;
  // Full session id → the worktree's repo and ticket, from the transcripts.
  sessionTickets: Map<string, TicketRef>;
  worktrees: Worktree[];
};

export type SessionStatus = "running" | "finished" | "idle";
export type Verdict = "running" | "done" | "parked" | "stalled" | "idle";

export type Row = {
  repo: string;
  ticket: number | null;
  title: string;
  issueUrl: string | null;
  stateLabels: string[];
  session: {
    id: string;
    kind: string;
    status: SessionStatus;
    startedAt: number;
    name: string;
  } | null;
  branch: { name: string; ahead: number; pushed: boolean } | null;
  pr: { number: number; draft: boolean; url: string } | null;
  verdict: Verdict;
};

const STATE_LABEL = /^(in-progress|in-review|needs-human|ready-for-agent)$/;
const BUSY_LABEL = /^(in-progress|in-review|needs-human)$/;

export function buildRows(s: Sources): Row[] {
  const rows = new Map<string, Row>();
  const ticketRow = (repo: Repo, n: number): Row => {
    const key = `${repo.root}#${n}`;
    let r = rows.get(key);
    if (!r) {
      const issue = repo.issues.find((i) => i.number === n);
      r = {
        repo: repo.name,
        ticket: n,
        title: issue?.title ?? "(closed or unknown)",
        issueUrl: issue?.url ?? `https://github.com/${repo.name}/issues/${n}`,
        stateLabels: issue?.labels.map((l) => l.name).filter((l) => STATE_LABEL.test(l)) ?? [],
        session: null,
        branch: null,
        pr: null,
        verdict: "idle",
      };
      rows.set(key, r);
    }
    return r;
  };

  for (const repo of s.repos) {
    for (const i of repo.issues) {
      if (i.labels.some((l) => BUSY_LABEL.test(l.name))) ticketRow(repo, i.number);
    }
  }
  for (const sess of s.sessions) {
    const root = s.sessionRoots.get(sess.cwd) ?? null;
    const repo = s.repos.find((r) => r.root === root);
    const status: SessionStatus =
      sess.status === "busy" ? "running" : sess.kind === "background" ? "finished" : "idle";
    const session = {
      id: shortSessionId(sess.sessionId),
      kind: sess.kind,
      status,
      startedAt: sess.startedAt,
      name: sess.name ?? "",
    };
    const hit = s.sessionTickets.get(sess.sessionId);
    const n = hit && repo && hit.root === repo.root ? hit.ticket : ticketOfPath(sess.cwd);
    if (repo && n) {
      const r = ticketRow(repo, n);
      if (!r.session || sess.startedAt > r.session.startedAt) r.session = session;
    } else {
      rows.set(sess.sessionId, {
        repo: repo?.name ?? sess.cwd.replace(s.home, "~"),
        ticket: null,
        title: sess.name || "(no ticket)",
        issueUrl: null,
        stateLabels: [],
        session,
        branch: null,
        pr: null,
        verdict: status === "running" ? "running" : "idle",
      });
    }
  }
  for (const wt of s.worktrees) {
    const repo = s.repos.find((r) => r.root === wt.root);
    if (!repo) continue;
    ticketRow(repo, wt.ticket).branch = {
      name: wt.branch,
      ahead: wt.ahead,
      pushed: repo.pushed.has(wt.branch),
    };
  }
  for (const repo of s.repos) {
    for (const p of repo.prs) {
      const m = /closes\s+#(\d+)/i.exec(p.body ?? "");
      const n = m
        ? Number(m[1])
        : [...rows.values()].find((r) => r.repo === repo.name && r.branch?.name === p.headRefName)
            ?.ticket;
      if (!n) continue;
      ticketRow(repo, n).pr = { number: p.number, draft: p.isDraft, url: p.url };
    }
  }
  for (const r of rows.values()) {
    if (r.ticket === null) continue;
    if (r.session?.status === "running") r.verdict = "running";
    else if (r.stateLabels.includes("needs-human")) r.verdict = "parked";
    else if (r.pr && !r.pr.draft) r.verdict = "done";
    else if (r.session?.status === "finished") r.verdict = "stalled";
  }
  // A closed ticket stays only while a session still runs or a PR is open;
  // a finished ticketless background session is noise.
  return [...rows.values()]
    .filter((r) => {
      if (r.ticket === null) return r.session?.status !== "finished";
      const repo = s.repos.find((x) => x.name === r.repo);
      return repo?.issues.some((i) => i.number === r.ticket) || r.verdict === "running" || r.pr;
    })
    .sort(
      (a, b) =>
        a.repo.localeCompare(b.repo) ||
        (a.ticket ?? Number.MAX_SAFE_INTEGER) - (b.ticket ?? Number.MAX_SAFE_INTEGER),
    );
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
