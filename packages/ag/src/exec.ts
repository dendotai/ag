// CLAUDECODE marks a running Claude Code session and blocks nested `claude`
// commands, so every child runs without it: the dashboard and the stop hook
// both start inside a session at times.
export const childEnv = (): Record<string, string | undefined> => ({ ...process.env, CLAUDECODE: undefined });

export type RunResult = { ok: boolean; out: string };

export async function run(cmd: string[], cwd?: string): Promise<RunResult> {
  try {
    const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "ignore", env: childEnv() });
    const out = await new Response(proc.stdout).text();
    return { ok: (await proc.exited) === 0, out: out.trim() };
  } catch {
    return { ok: false, out: "" };
  }
}
