import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRows, parseWorktrees, type Session, type Sources } from "../src/dash/rows.ts";
import { readSessionTickets, transcriptPrefix } from "../src/dash/transcripts.ts";

const issue = (number: number, title: string, ...labels: string[]) => ({
  number,
  title,
  url: `https://github.com/o/r/issues/${number}`,
  labels: labels.map((name) => ({ name })),
});
const pr = (number: number, isDraft: boolean, body: string, headRefName: string) => ({
  number,
  isDraft,
  url: `https://github.com/o/r/pull/${number}`,
  body,
  headRefName,
});
const session = (
  sessionId: string,
  cwd: string,
  startedAt: number,
  status: string | null = null,
  kind = "background",
): Session => ({
  sessionId,
  kind,
  cwd,
  startedAt,
  status,
  name: `session ${sessionId.slice(0, 8)}`,
});

const root = "/home/me/repo";
const other = "/home/me/other";
const wt = (n: number, base = root) => `${base}/.claude/worktrees/impl-${n}`;

const sources: Sources = {
  home: "/home/me",
  repos: [
    {
      root,
      name: "o/r",
      issues: [
        issue(1, "running one", "in-progress", "ready-for-agent", "p2"),
        issue(2, "reviewed one", "in-review", "ready-for-agent"),
        issue(3, "parked one", "needs-human"),
        issue(4, "stalled one", "in-progress"),
        issue(5, "idle one", "in-progress"),
        issue(9, "untouched one", "ready-for-agent"),
      ],
      prs: [
        pr(20, false, "Closes #2\n\nbody", "feature/two"),
        pr(30, true, "no closing line", "feature/three"),
      ],
      pushed: new Set(["feature/two", "feature/three"]),
    },
    {
      root: other,
      name: "o/other",
      issues: [issue(3, "other three", "in-progress")],
      prs: [],
      pushed: new Set(),
    },
  ],
  sessions: [
    session("11111111-aaaa", wt(1), 100, "busy"),
    session("22222222-aaaa", wt(4), 100),
    // A finished session reports the main checkout as cwd; the transcript
    // map names its ticket.
    session("66666666-aaaa", root, 100, "busy"),
    session("77777777-aaaa", root, 100),
    // Interactive sessions count: an older busy one in the same worktree
    // loses to the newer background one above.
    session("88888888-aaaa", wt(1), 50, "busy", "interactive"),
    session("99999999-aaaa", root, 100, "idle", "interactive"),
    session("aaaaaaaa-aaaa", "/home/me/scratch", 100, "busy", "interactive"),
    session("bbbbbbbb-aaaa", "/home/me/scratch", 100),
    // The other repo's impl-3 is that repo's ticket, not ours.
    session("cccccccc-aaaa", wt(3, other), 100, "busy"),
  ],
  sessionRoots: new Map([
    [wt(1), root],
    [wt(4), root],
    [root, root],
    [wt(3, other), other],
    ["/home/me/scratch", null],
  ]),
  sessionTickets: new Map([
    ["66666666-aaaa", { root, ticket: 6 }],
    ["77777777-aaaa", { root, ticket: 7 }],
  ]),
  worktrees: [
    { root, ticket: 1, branch: "feature/one", ahead: 3 },
    { root, ticket: 2, branch: "feature/two", ahead: 2 },
    { root, ticket: 3, branch: "feature/three", ahead: 1 },
  ],
};

const rows = buildRows(sources);
const row = (n: number, repo = "o/r") => rows.find((r) => r.repo === repo && r.ticket === n);

test("verdicts: running, done, parked, stalled, idle; rows grouped by repo, ticketless last in a repo", () => {
  expect(rows.map((r) => [r.repo, r.ticket, r.verdict])).toEqual([
    ["~/scratch", null, "running"],
    ["o/other", 3, "running"],
    ["o/r", 1, "running"],
    ["o/r", 2, "done"],
    ["o/r", 3, "parked"],
    ["o/r", 4, "stalled"],
    ["o/r", 5, "idle"],
    ["o/r", 6, "running"],
    ["o/r", null, "idle"],
  ]);
});

test("the ticket without a state label, session, worktree or PR has no row", () => {
  expect(row(9)).toBeUndefined();
});

test("a closed ticket stays only while a session runs", () => {
  expect(row(6)?.title).toBe("(closed or unknown)");
  expect(row(6)?.issueUrl).toBe("https://github.com/o/r/issues/6");
  expect(row(7)).toBeUndefined();
});

test("session: short id, kind, status, start time and name; the newest session wins", () => {
  expect(row(1)?.session).toEqual({
    id: "11111111",
    kind: "background",
    status: "running",
    startedAt: 100,
    name: "session 11111111",
  });
  expect(row(4)?.session?.status).toBe("finished");
});

test("a session in another repo's impl-N worktree belongs to that repo", () => {
  expect(row(3)?.session).toBeNull();
  expect(row(3, "o/other")?.session?.id).toBe("cccccccc");
});

test("ticketless sessions: an idle interactive chat in the repo, a busy one outside; finished ones are dropped", () => {
  const inRepo = rows.find((r) => r.ticket === null && r.repo === "o/r");
  expect(inRepo?.title).toBe("session 99999999");
  expect(inRepo?.session?.status).toBe("idle");
  const outside = rows.find((r) => r.repo === "~/scratch");
  expect(outside?.session?.id).toBe("aaaaaaaa");
  expect(rows.some((r) => r.session?.id === "bbbbbbbb")).toBe(false);
});

test("branch: name, commits ahead, pushed", () => {
  expect(row(1)?.branch).toEqual({ name: "feature/one", ahead: 3, pushed: false });
  expect(row(2)?.branch).toEqual({ name: "feature/two", ahead: 2, pushed: true });
});

test("PR: by Closes #N, else by head branch; draft flag", () => {
  expect(row(2)?.pr).toEqual({ number: 20, draft: false, url: "https://github.com/o/r/pull/20" });
  expect(row(3)?.pr).toEqual({ number: 30, draft: true, url: "https://github.com/o/r/pull/30" });
});

test("state labels keep only the runner's labels", () => {
  expect(row(1)?.stateLabels).toEqual(["in-progress", "ready-for-agent"]);
});

test("parseWorktrees maps impl-N worktrees to their branch", () => {
  const porcelain = [
    "worktree /repo",
    "HEAD aaaa",
    "branch refs/heads/dev",
    "",
    "worktree /repo/.claude/worktrees/impl-12",
    "HEAD bbbb",
    "branch refs/heads/feature/twelve",
    "",
    "worktree /repo/.claude/worktrees/scratch",
    "HEAD cccc",
    "detached",
    "",
  ].join("\n");
  expect(parseWorktrees(porcelain)).toEqual(
    new Map([[12, { path: "/repo/.claude/worktrees/impl-12", branch: "feature/twelve" }]]),
  );
});

test("transcriptPrefix encodes the repo root the way Claude Code does", () => {
  expect(transcriptPrefix("/Users/den/Projects/_tools/ag")).toBe(
    "-Users-den-Projects--tools-ag--claude-worktrees-impl-",
  );
});

test("readSessionTickets maps transcript files to their repo and ticket", () => {
  const projects = mkdtempSync(join(tmpdir(), "ag-dash-projects-"));
  try {
    const prefix = transcriptPrefix("/repo");
    mkdirSync(join(projects, `${prefix}5`));
    writeFileSync(join(projects, `${prefix}5`, "aaaa-1111.jsonl"), "");
    writeFileSync(join(projects, `${prefix}5`, "notes.txt"), "");
    mkdirSync(join(projects, `${prefix}x`));
    writeFileSync(join(projects, `${prefix}6`), "a file, not a directory");
    mkdirSync(join(projects, "-other-repo"));
    expect(readSessionTickets(projects, ["/repo"])).toEqual(
      new Map([["aaaa-1111", { root: "/repo", ticket: 5 }]]),
    );
    expect(readSessionTickets(join(projects, "missing"), ["/repo"])).toEqual(new Map());
  } finally {
    rmSync(projects, { recursive: true, force: true });
  }
});
