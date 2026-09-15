import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookInput } from "../src/stop-hook.ts";

const cli = new URL("../src/cli.ts", import.meta.url).pathname;
const stubs = new URL("./stubs", import.meta.url).pathname;
const sessionId = "abcdef12-3456-7890-abcd-ef1234567890";
const stopCall = "claude stop abcdef12 CLAUDECODE=unset";

let dir: string;
let log: string;
let ticket7: HookInput;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ag-stop-hook-"));
  log = join(dir, "calls.log");
  const cwd = join(dir, ".claude", "worktrees", "7-seven");
  mkdirSync(cwd, { recursive: true });
  ticket7 = { session_id: sessionId, cwd };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);

async function hook(input: HookInput, env: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", cli, "stop-hook"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      PATH: `${stubs}:${process.env.PATH}`,
      TMPDIR: dir,
      STUB_LOG: log,
      CLAUDECODE: "1",
      ...env,
    },
  });
  proc.stdin.write(JSON.stringify({ ...input, stop_hook_active: false }));
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

const blockReason = async (input: HookInput, env: Record<string, string>) =>
  (JSON.parse((await hook(input, env)).stdout) as { decision: "block"; reason: string }).reason;

// The stop runs detached after a short delay, so the stub's record arrives
// after the hook has exited.
async function waitForStop(): Promise<string | undefined> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const hit = calls().find((c) => c.startsWith("claude stop"));
    if (hit) return hit;
    await Bun.sleep(100);
  }
  return undefined;
}

test("closed ticket: the session is stopped, detached and without CLAUDECODE", async () => {
  const res = await hook(ticket7, { STUB_GH_OUT: "CLOSED" });
  expect(res.exitCode).toBe(0);
  expect(res.stdout).toBe("");
  expect(calls()).toContain(
    'gh issue view 7 --json state,labels --jq [.state, .labels[].name] | join(" ")',
  );
  expect(await waitForStop()).toBe(stopCall);
});

test("ticket in review: the session is stopped", async () => {
  const res = await hook(ticket7, { STUB_GH_OUT: "OPEN in-review ready-for-agent" });
  expect(res.stdout).toBe("");
  expect(await waitForStop()).toBe(stopCall);
});

test("unfinished ticket: the stop is refused with the reason", async () => {
  const res = await hook(ticket7, { STUB_GH_OUT: "OPEN in-progress ready-for-agent" });
  expect(res.exitCode).toBe(0);
  const out = JSON.parse(res.stdout) as { decision: string; reason: string };
  expect(out.decision).toBe("block");
  expect(out.reason).toContain("ticket #7");
  expect(out.reason).toContain("labels: OPEN in-progress ready-for-agent");
  expect(out.reason).toContain("TaskOutput");
  expect(out.reason).toContain("Stop refusal 1 of 5.");
  expect(calls().some((c) => c.startsWith("claude"))).toBe(false);
});

test("gh failure counts as unfinished: the stop is refused", async () => {
  expect(await blockReason(ticket7, { STUB_GH_EXIT: "1" })).toContain("labels: (gh failed)");
});

test("refusals past the cap: the session is stopped anyway", async () => {
  const env = { STUB_GH_OUT: "OPEN in-progress", AGENT_MAX_STOP_BLOCKS: "2" };
  expect(await blockReason(ticket7, env)).toContain("Stop refusal 1 of 2.");
  expect(await blockReason(ticket7, env)).toContain("Stop refusal 2 of 2.");
  const third = await hook(ticket7, env);
  expect(third.stdout).toBe("");
  expect(await waitForStop()).toBe(stopCall);
});

test("an unreadable cap falls back to the default", async () => {
  expect(
    await blockReason(ticket7, { STUB_GH_OUT: "OPEN", AGENT_MAX_STOP_BLOCKS: "many" }),
  ).toContain("Stop refusal 1 of 5.");
});

test("an empty cap falls back to the default, it does not disable the hook", async () => {
  expect(await blockReason(ticket7, { STUB_GH_OUT: "OPEN", AGENT_MAX_STOP_BLOCKS: "" })).toContain(
    "Stop refusal 1 of 5.",
  );
});

test("a <number>-<slug> directory outside the worktrees dir is not a ticket", async () => {
  const cwd = join(dir, "2024-migration");
  mkdirSync(cwd);
  const res = await hook({ session_id: sessionId, cwd });
  expect(res.exitCode).toBe(0);
  expect(res.stdout).toBe("");
  expect(await waitForStop()).toBe(stopCall);
  expect(calls().some((c) => c.startsWith("gh"))).toBe(false);
});
