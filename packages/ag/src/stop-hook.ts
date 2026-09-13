// `ag stop-hook` — the Stop hook of the sessions the runner launches.
// Claude Code runs it every time the session ends a turn, with a JSON object
// on stdin (session_id, cwd, stop_hook_active). The turn also ends when the
// session merely waits for a background subagent, so "turn ended" is not
// "work done". The ticket's labels are: the session's last step sets
// in-review or needs-human. With one of them present the session is stopped;
// without, the stop is refused and the session continues with the reason as
// its next input. AGENT_MAX_STOP_BLOCKS (5) refusals per session, then the
// session is stopped anyway, so a session that can never reach the label
// does not run forever.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childEnv, run } from "./exec.ts";

type HookInput = { session_id: string; cwd: string; stop_hook_active?: boolean };

// Detached, because a child of the hook dies with the hook. The delay lets
// the hook return and the turn end before the stop lands.
function stopSession(sessionId: string): void {
  const child = spawn("bash", ["-c", `sleep 2; claude stop ${sessionId.slice(0, 8)}`], {
    detached: true,
    stdio: "ignore",
    env: childEnv(),
  });
  child.unref();
}

async function ticketLabels(n: number, cwd: string): Promise<string> {
  const res = await run(["gh", "issue", "view", String(n), "--json", "state,labels", "--jq", '[.state, .labels[].name] | join(" ")'], cwd);
  return res.ok ? res.out : "(gh failed)";
}

// One refusal count per session, in the temp dir like the counter of the
// shell version, so a rerun of the hook in the same session continues it.
function countRefusal(sessionId: string): number {
  const counter = join(tmpdir(), `ag-stop-hook-${sessionId}`);
  let previous = 0;
  try {
    previous = Number(readFileSync(counter, "utf8")) || 0;
  } catch {}
  const count = previous + 1;
  writeFileSync(counter, String(count));
  return count;
}

export async function stopHook(input: HookInput): Promise<void> {
  const sid = input.session_id;
  const maxBlocks = Number(process.env.AGENT_MAX_STOP_BLOCKS ?? 5);

  const m = /\/impl-(\d+)$/.exec(input.cwd);
  if (!m) return stopSession(sid);
  const n = Number(m[1]);

  // A closed ticket has its state labels stripped, so the state is checked too.
  const labels = await ticketLabels(n, input.cwd);
  const words = labels.split(" ");
  if (words.includes("CLOSED") || words.includes("in-review") || words.includes("needs-human")) return stopSession(sid);

  const count = countRefusal(sid);
  if (count > maxBlocks) return stopSession(sid);

  const reason =
    `Unattended ag session: ticket #${n} carries neither in-review nor needs-human (labels: ${labels}), ` +
    "so the work is not finished. Never end the turn to wait for anything. If subagents are still running, " +
    "call TaskOutput to collect their results now. Then finish: commit, push, open the pull request, and set " +
    "the label — in-review for a normal PR, or needs-human with the parking comment. " +
    `Stop refusal ${count} of ${maxBlocks}.`;
  console.log(JSON.stringify({ decision: "block", reason }));
}

export async function stopHookMain(): Promise<void> {
  const input = JSON.parse(await Bun.stdin.text()) as HookInput;
  await stopHook(input);
}
