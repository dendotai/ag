// `ag dash` — local dashboard over the runner's sessions of the current repo.
// Polls `claude agents` and the worktrees every AGENT_DASH_POLL seconds (2),
// GitHub and the remote every AGENT_DASH_POLL_GH seconds (10).
// Serves http://localhost:${AGENT_DASH_PORT:-7878}.
import { homedir } from "node:os";
import { join } from "node:path";
import { run } from "../exec.ts";
import { page } from "./page.ts";
import { buildRows, parseWorktrees, sessionTickets, transcriptPrefix, type Issue, type Pr, type Row, type Session } from "./rows.ts";

type Remote = { issues: Issue[]; prs: Pr[]; pushed: Set<string> };
type State = { rows: Row[]; updatedAt: number; error: string | null };

export async function dashMain(_args: string[]): Promise<void> {
  const port = Number(process.env.AGENT_DASH_PORT ?? 7878);
  const pollMs = Number(process.env.AGENT_DASH_POLL ?? 2) * 1000;
  const remotePollMs = Number(process.env.AGENT_DASH_POLL_GH ?? 10) * 1000;

  // The first entry of the worktree list is the main checkout, also when the
  // dashboard starts inside a linked worktree.
  const worktreeList = await run(["git", "worktree", "list", "--porcelain"]);
  const root = worktreeList.out.split("\n")[0]?.replace(/^worktree /, "") ?? "";
  if (!worktreeList.ok || !root) {
    console.error("ag dash: not inside a git repository");
    process.exit(2);
  }
  const repo = (await run(["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], root)).out;
  const defaultBranch =
    (await run(["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"], root)).out.replace(/^origin\//, "") || "dev";
  const prefix = transcriptPrefix(root);
  const projectsDir = join(homedir(), ".claude", "projects");

  // GitHub and the remote are slow and rate-limited; poll them less often
  // than the local sources and keep the last answer.
  let remote: Remote = { issues: [], prs: [], pushed: new Set() };
  async function fetchRemote(): Promise<void> {
    const [issuesRes, prsRes, remoteHeads] = await Promise.all([
      run(["gh", "issue", "list", "--state", "open", "--limit", "200", "--json", "number,title,labels,url"], root),
      run(["gh", "pr", "list", "--state", "open", "--json", "number,isDraft,title,url,body,headRefName"], root),
      run(["git", "ls-remote", "--heads", "origin"], root),
    ]);
    if (!issuesRes.ok || !prsRes.ok || !remoteHeads.ok) throw new Error("gh or git ls-remote failed");
    remote = {
      issues: JSON.parse(issuesRes.out) as Issue[],
      prs: JSON.parse(prsRes.out) as Pr[],
      pushed: new Set(remoteHeads.out.split("\n").map((l) => l.split("\trefs/heads/")[1]).filter((b): b is string => !!b)),
    };
  }

  async function collect(): Promise<Row[]> {
    const [agentsRes, wtRes] = await Promise.all([run(["claude", "agents", "--json", "--all"]), run(["git", "worktree", "list", "--porcelain"], root)]);
    const sessions = agentsRes.ok ? (JSON.parse(agentsRes.out) as Session[]) : [];
    const worktrees = await Promise.all(
      [...parseWorktrees(wtRes.out)].map(async ([ticket, wt]) => {
        const ahead = await run(["git", "rev-list", "--count", `origin/${defaultBranch}..HEAD`], wt.path);
        return { ticket, branch: wt.branch, ahead: Number(ahead.out) || 0 };
      }),
    );
    return buildRows({ repo, ...remote, sessions, sessionTickets: sessionTickets(projectsDir, prefix), worktrees });
  }

  let state: State = { rows: [], updatedAt: 0, error: null };
  async function refresh(): Promise<void> {
    try {
      state = { rows: await collect(), updatedAt: Date.now(), error: null };
    } catch (e) {
      state = { ...state, error: String(e) };
    }
  }
  async function refreshRemote(): Promise<void> {
    try {
      await fetchRemote();
    } catch (e) {
      state = { ...state, error: String(e) };
    }
  }
  await refreshRemote();
  await refresh();
  setInterval(refresh, pollMs);
  setInterval(refreshRemote, remotePollMs);

  const html = page(repo);
  Bun.serve({
    port,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/api/state") return Response.json(state);
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    },
  });
  console.log(`ag dash: ${repo} → http://localhost:${port}  (poll ${pollMs / 1000}s)`);
}
