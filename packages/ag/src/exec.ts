export type RunResult = { ok: boolean; out: string };

export async function run(cmd: string[], cwd?: string): Promise<RunResult> {
  try {
    const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "ignore" });
    const out = await new Response(proc.stdout).text();
    return { ok: (await proc.exited) === 0, out: out.trim() };
  } catch {
    return { ok: false, out: "" };
  }
}
