// `ag stop-hook` — the Stop hook of the sessions the runner launches.
// Claude Code runs it every time the session ends a turn, with a JSON object
// on stdin. The turn also ends when the session merely waits for a
// background subagent, so "turn ended" is not "work done". The ticket's
// labels are: the session's last step sets in-review or needs-human. With
// one of them present the session is stopped; without, the stop is refused
// and the session continues with the reason as its next input.
// AGENT_MAX_STOP_BLOCKS (5) refusals per session, then the session is
// stopped anyway, so a session that can never reach the label does not run
// forever.
import { spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childEnv, run } from "./exec.ts";
import { shortSessionId, ticketOfPath } from "./ticket.ts";

// Claude Code also sends stop_hook_active; the hook does not read it.
export type HookInput = { session_id: string; cwd: string };

const DEFAULT_MAX_BLOCKS = 5;

const counterPath = (sessionId: string): string => join(tmpdir(), `ag-stop-hook-${sessionId}`);

// Detached, because a child of the hook dies with the hook. The delay lets
// the hook return and the turn end before the stop lands.
function stopSession(sessionId: string): void {
  rmSync(counterPath(sessionId), { force: true });
  const child = spawn("sh", ["-c", 'sleep 2; claude stop "$1"', "sh", shortSessionId(sessionId)], {
    detached: true,
    stdio: "ignore",
    env: childEnv(),
  });
  child.unref();
}

async function ticketLabels(n: number, cwd: string): Promise<string> {
  const res = await run(
    [
      "gh",
      "issue",
      "view",
      String(n),
      "--json",
      "state,labels",
      "--jq",
      '[.state, .labels[].name] | join(" ")',
    ],
    cwd,
  );
  return res.ok ? res.out : "(gh failed)";
}

function countRefusal(sessionId: string): number {
  let previous = 0;
  try {
    previous = Number(readFileSync(counterPath(sessionId), "utf8")) || 0;
  } catch {}
  const count = previous + 1;
  writeFileSync(counterPath(sessionId), String(count));
  return count;
}

// An empty AGENT_MAX_STOP_BLOCKS is a blanked settings entry, not a cap of
// 0: Number("") is 0, which would stop every session after its first turn.
function maxBlocks(): number {
  const raw = process.env.AGENT_MAX_STOP_BLOCKS?.trim();
  if (!raw) return DEFAULT_MAX_BLOCKS;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_MAX_BLOCKS;
}

export async function stopHook(input: HookInput): Promise<void> {
  const sid = input.session_id;
  const n = ticketOfPath(input.cwd);
  if (!n) return stopSession(sid);

  // A closed ticket has its state labels stripped, so the state is checked too.
  const labels = await ticketLabels(n, input.cwd);
  const words = labels.split(" ");
  if (words.includes("CLOSED") || words.includes("in-review") || words.includes("needs-human"))
    return stopSession(sid);

  const max = maxBlocks();
  const count = countRefusal(sid);
  if (count > max) return stopSession(sid);

  const reason =
    `Unattended ag session: ticket #${n} carries neither in-review nor needs-human (labels: ${labels}), ` +
    "so the work is not finished. Never end the turn to wait for anything. If subagents are still running, " +
    "call TaskOutput to collect their results now. Then finish: commit, push, open the pull request, and set " +
    "the label — in-review for a normal PR, or needs-human with the parking comment. " +
    `Stop refusal ${count} of ${max}.`;
  console.log(JSON.stringify({ decision: "block", reason }));
}

export async function stopHookMain(): Promise<void> {
  await stopHook(JSON.parse(await Bun.stdin.text()) as HookInput);
}
