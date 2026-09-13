import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRows, parseWorktrees, sessionTickets, transcriptPrefix, type Sources } from "../src/dash/rows.ts";

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
const session = (sessionId: string, cwd: string, startedAt: number, status: string | null = null) => ({
  sessionId,
  kind: "background",
  cwd,
  startedAt,
  status,
});

const wt = (n: number) => `/repo/.claude/worktrees/impl-${n}`;

const sources: Sources = {
  repo: "o/r",
  issues: [
    issue(1, "running one", "in-progress", "ready-for-agent", "p2"),
    issue(2, "reviewed one", "in-review", "ready-for-agent"),
    issue(3, "parked one", "needs-human"),
    issue(4, "stalled one", "in-progress"),
    issue(5, "idle one", "in-progress"),
    issue(9, "untouched one", "ready-for-agent"),
  ],
  prs: [pr(20, false, "Closes #2\n\nbody", "feature/two"), pr(30, true, "no closing line", "feature/three")],
  pushed: new Set(["feature/two", "feature/three"]),
  sessions: [
    session("11111111-aaaa", wt(1), 100, "busy"),
    session("22222222-aaaa", wt(4), 100),
    session("33333333-aaaa", "/somewhere/else", 200, "busy"),
    // A finished session no longer reports its worktree as cwd; the
    // transcript map names its ticket.
    session("66666666-aaaa", "/repo", 100, "busy"),
    session("77777777-aaaa", "/repo", 100),
    { ...session("88888888-aaaa", wt(1), 300, "busy"), kind: "interactive" },
  ],
  sessionTickets: new Map([
    ["66666666-aaaa", 6],
    ["77777777-aaaa", 7],
  ]),
  worktrees: [
    { ticket: 1, branch: "feature/one", ahead: 3 },
    { ticket: 2, branch: "feature/two", ahead: 2 },
    { ticket: 3, branch: "feature/three", ahead: 1 },
  ],
};

const rows = buildRows(sources);
const row = (n: number) => rows.find((r) => r.ticket === n);

test("verdicts: running, done, parked, stalled, idle", () => {
  expect(rows.map((r) => [r.ticket, r.verdict])).toEqual([
    [1, "running"],
    [2, "done"],
    [3, "parked"],
    [4, "stalled"],
    [5, "idle"],
    [6, "running"],
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

test("session: short id, status and start time; interactive sessions are ignored", () => {
  expect(row(1)?.session).toEqual({ id: "11111111", status: "running", startedAt: 100 });
  expect(row(4)?.session).toEqual({ id: "22222222", status: "finished", startedAt: 100 });
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
  expect(transcriptPrefix("/Users/den/Projects/_tools/ag")).toBe("-Users-den-Projects--tools-ag--claude-worktrees-impl-");
});

test("sessionTickets maps transcript files to tickets", () => {
  const projects = mkdtempSync(join(tmpdir(), "ag-dash-projects-"));
  try {
    const prefix = "-repo--claude-worktrees-impl-";
    mkdirSync(join(projects, `${prefix}5`));
    writeFileSync(join(projects, `${prefix}5`, "aaaa-1111.jsonl"), "");
    writeFileSync(join(projects, `${prefix}5`, "notes.txt"), "");
    mkdirSync(join(projects, `${prefix}x`));
    mkdirSync(join(projects, "-other-repo"));
    expect(sessionTickets(projects, prefix)).toEqual(new Map([["aaaa-1111", 5]]));
  } finally {
    rmSync(projects, { recursive: true, force: true });
  }
});
