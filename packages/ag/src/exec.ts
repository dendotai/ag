export type RunResult = { ok: boolean; out: string; err: string };

export async function run(cmd: string[], cwd?: string): Promise<RunResult> {
  try {
    const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { ok: (await proc.exited) === 0, out: out.trim(), err: err.trim() };
  } catch (e) {
    return { ok: false, out: "", err: String(e) };
  }
}
