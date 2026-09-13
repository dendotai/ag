// The worktree engine: is this checkout a git worktree, what is its name,
// which port and lifetime does its environment get. Knows no stack.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { basename, join, resolve } from "node:path";

export type EnvValues = Record<string, string>;

export type GitResult = { status: number | null; stdout: string };
export type Git = (args: string[]) => GitResult;

export function gitIn(cwd: string): Git {
  return (args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    return { status: result.error ? 128 : result.status, stdout: result.stdout ?? "" };
  };
}

// A linked worktree has its own git dir under the main checkout's `.git`;
// the main checkout's git dir and common dir are the same directory.
export function isWorktree(root: string, git: Git): boolean {
  const gitDir = git(["rev-parse", "--git-dir"]);
  const commonDir = git(["rev-parse", "--git-common-dir"]);
  if (gitDir.status !== 0 || commonDir.status !== 0) return false;
  return resolve(root, gitDir.stdout.trim()) !== resolve(root, commonDir.stdout.trim());
}

// Ports the sibling worktrees wrote into their own port file; a server there
// need not be running for the port to be taken.
export function heldPorts(root: string, git: Git, portFile: string): Set<number> {
  const held = new Set<number>();
  const list = git(["worktree", "list", "--porcelain"]);
  if (list.status !== 0) return held;
  for (const line of list.stdout.split("\n")) {
    if (!line.startsWith("worktree ")) continue;
    const dir = line.slice("worktree ".length);
    if (resolve(dir) === resolve(root)) continue;
    const port = Number(parseEnvFile(join(dir, portFile)).PORT);
    if (Number.isInteger(port)) held.add(port);
  }
  return held;
}

// 3000 belongs to the main checkout's dev server, so worktrees start above it.
export const MAIN_PORT = 3000;
export const PORT_BAND = { first: 3001, last: 3099 };

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer();
    server.once("error", () => done(false));
    server.listen(port, "127.0.0.1", () => server.close(() => done(true)));
  });
}

export async function pickPort(
  current: number | undefined,
  held: Set<number>,
  isFree: (port: number) => Promise<boolean> = isPortFree,
): Promise<number> {
  if (current !== undefined && current >= PORT_BAND.first && current <= PORT_BAND.last) {
    return current;
  }
  for (let port = PORT_BAND.first; port <= PORT_BAND.last; port++) {
    if (!held.has(port) && (await isFree(port))) return port;
  }
  throw new Error(`no free port between ${PORT_BAND.first} and ${PORT_BAND.last}`);
}

export function parseEnvFile(path: string): EnvValues {
  if (!existsSync(path)) return {};
  const out: EnvValues = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) out[match[1] as string] = (match[2] as string).replace(/\s+#.*$/, "").trim();
  }
  return out;
}

// Replaces the line of each key that exists and appends the others, so the
// developer's own lines in the file survive.
export function upsertEnvFile(path: string, entries: EnvValues): void {
  let text = existsSync(path) ? readFileSync(path, "utf8") : "";
  for (const [key, value] of Object.entries(entries)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    if (pattern.test(text)) text = text.replace(pattern, line);
    else text += `${text.length === 0 || text.endsWith("\n") ? "" : "\n"}${line}\n`;
  }
  writeFileSync(path, text);
}

export const DEFAULT_LIFETIME_DAYS = 14;

export interface SetupOverrides {
  /** Forces the worktree form with this environment name. */
  name?: string;
  port?: number;
  /** Lifetime in days; null means no expiration. */
  expires?: number | null;
}

export interface SetupPlan {
  /** Environment name; null means the developer's own environment. */
  name: string | null;
  port: number;
  /** Lifetime in days; null means no expiration. */
  expires: number | null;
}

export async function planSetup(input: {
  root: string;
  git: Git;
  /** Path, relative to a checkout, of the env file that records its PORT. */
  portFile: string;
  overrides?: SetupOverrides;
  isFree?: (port: number) => Promise<boolean>;
}): Promise<SetupPlan> {
  const { root, git, portFile, overrides = {}, isFree } = input;
  const name = overrides.name ?? (isWorktree(root, git) ? basename(root) : null);
  const isolated = name !== null;
  let port = overrides.port;
  if (port === undefined) {
    port = isolated
      ? await pickPort(
          Number(parseEnvFile(join(root, portFile)).PORT) || undefined,
          heldPorts(root, git, portFile),
          isFree,
        )
      : MAIN_PORT;
  }
  const expires =
    overrides.expires === undefined ? (isolated ? DEFAULT_LIFETIME_DAYS : null) : overrides.expires;
  return { name, port, expires };
}
