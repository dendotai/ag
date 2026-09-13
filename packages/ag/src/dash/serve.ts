// `ag dash` — local dashboard over every Claude session on this machine.
// Repos are discovered from the sessions' working directories, plus the one
// the dashboard starts in. Polls `claude agents` and the worktrees every
// AGENT_DASH_POLL seconds (2), GitHub and the remotes every
// AGENT_DASH_POLL_GH seconds (10). Serves http://localhost:${AGENT_DASH_PORT:-7878}.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { run } from "../exec.ts";
import { page } from "./page.ts";
import { buildRows, parseWorktrees, type Issue, type Pr, type Repo, type Row, type Session, type Worktree } from "./rows.ts";
import { readSessionTickets } from "./transcripts.ts";

type TrackedRepo = Repo & { defaultBranch: string; remoteError: string | null };
type State = { rows: Row[]; repos: string[]; updatedAt: number; error: string | null; remoteError: string | null };

export async function dashMain(): Promise<void> {
  const port = Number(process.env.AGENT_DASH_PORT ?? 7878);
  const pollMs = Number(process.env.AGENT_DASH_POLL ?? 2) * 1000;
  const remotePollMs = Number(process.env.AGENT_DASH_POLL_GH ?? 10) * 1000;
  const home = homedir();
  const projectsDir = join(home, ".claude", "projects");

  // Main checkout of the repo that holds cwd; a worktree resolves to its main
  // checkout, because that is where the tickets, PRs and worktree list live.
  const rootCache = new Map<string, string | null>();
  async function repoRoot(cwd: string): Promise<string | null> {
    const hit = rootCache.get(cwd);
    if (hit !== undefined) return hit;
    let root: string | null = null;
    if (existsSync(cwd)) {
      const r = await run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
      if (r.ok) root = dirname(r.out);
    }
    rootCache.set(cwd, root);
    return root;
  }

  // GitHub and the remote are slow and rate-limited: polled less often than
  // the local sources, last answer kept. A failed ls-remote keeps the old
  // pushed set; the issues and PRs still refresh.
  async function fetchRemote(repo: TrackedRepo): Promise<void> {
    const [issuesRes, prsRes, heads] = await Promise.all([
      run(["gh", "issue", "list", "--state", "open", "--limit", "200", "--json", "number,title,labels,url"], repo.root),
      run(["gh", "pr", "list", "--state", "open", "--json", "number,isDraft,url,body,headRefName"], repo.root),
      run(["git", "ls-remote", "--heads", "origin"], repo.root),
    ]);
    if (!issuesRes.ok || !prsRes.ok) {
      repo.remoteError = `gh failed in ${repo.name}`;
      return;
    }
    repo.issues = JSON.parse(issuesRes.out) as Issue[];
    repo.prs = JSON.parse(prsRes.out) as Pr[];
    if (heads.ok) repo.pushed = new Set(heads.out.split("\n").map((l) => l.split("\trefs/heads/")[1]).filter((b): b is string => !!b));
    repo.remoteError = null;
  }

  const repos = new Map<string, TrackedRepo>();
  async function addRepo(root: string): Promise<void> {
    if (repos.has(root)) return;
    const view = await run(["gh", "repo", "view", "--json", "nameWithOwner,defaultBranchRef"], root);
    const parsed = view.ok ? (JSON.parse(view.out) as { nameWithOwner: string; defaultBranchRef: { name: string } }) : null;
    const repo: TrackedRepo = {
      root,
      name: parsed?.nameWithOwner || root.split("/").slice(-2).join("/"),
      defaultBranch: parsed?.defaultBranchRef.name || "main",
      issues: [],
      prs: [],
      pushed: new Set(),
      remoteError: null,
    };
    repos.set(root, repo);
    await fetchRemote(repo);
  }

  async function worktrees(repo: TrackedRepo): Promise<Worktree[]> {
    const list = await run(["git", "worktree", "list", "--porcelain"], repo.root);
    return Promise.all(
      [...parseWorktrees(list.out)].map(async ([ticket, wt]) => {
        const ahead = await run(["git", "rev-list", "--count", `origin/${repo.defaultBranch}..HEAD`], wt.path);
        return { root: repo.root, ticket, branch: wt.branch, ahead: Number(ahead.out) || 0 };
      }),
    );
  }

  async function collect(): Promise<Row[]> {
    const agentsRes = await run(["claude", "agents", "--json", "--all"]);
    const sessions = agentsRes.ok ? (JSON.parse(agentsRes.out) as Session[]) : [];
    const sessionRoots = new Map<string, string | null>();
    for (const s of sessions) {
      const root = await repoRoot(s.cwd);
      sessionRoots.set(s.cwd, root);
      if (root) await addRepo(root);
    }
    const tracked = [...repos.values()];
    return buildRows({
      home,
      repos: tracked,
      sessions,
      sessionRoots,
      sessionTickets: readSessionTickets(projectsDir, tracked.map((r) => r.root)),
      worktrees: (await Promise.all(tracked.map(worktrees))).flat(),
    });
  }

  let state: State = { rows: [], repos: [], updatedAt: 0, error: null, remoteError: null };
  const remoteError = (): string | null => {
    const errors = [...repos.values()].map((r) => r.remoteError).filter((e): e is string => !!e);
    return errors.length ? errors.join("; ") : null;
  };
  async function refresh(): Promise<void> {
    try {
      const rows = await collect();
      state = { rows, repos: [...repos.values()].map((r) => r.name), updatedAt: Date.now(), error: null, remoteError: remoteError() };
    } catch (e) {
      state = { ...state, error: String(e) };
    }
  }
  async function refreshRemote(): Promise<void> {
    for (const repo of repos.values()) await fetchRemote(repo);
    state = { ...state, remoteError: remoteError() };
  }

  const startRoot = await repoRoot(process.cwd());
  if (startRoot) await addRepo(startRoot);
  await refresh();
  setInterval(refresh, pollMs);
  setInterval(refreshRemote, remotePollMs);

  Bun.serve({
    port,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/api/state") return Response.json(state);
      return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
    },
  });
  console.log(`ag dash → http://localhost:${port}  (local ${pollMs / 1000}s, github ${remotePollMs / 1000}s)`);
}
