/**
 * Git transport and commit signing for agent sessions.
 *
 * One ed25519 key made for agents only lives in the macOS login keychain.
 * On first use it is loaded into an in-memory ssh-agent at a fixed socket;
 * every later push and signature reuses that agent, so the keychain is read
 * once per login session. The key's source of truth is the developer's
 * secret manager; `import` copies it into the keychain while a human is
 * present, and nothing here reads the secret manager afterwards.
 *
 * Git is routed here by the `env` block of the Claude Code settings file:
 * `GIT_SSH_COMMAND` → `ag-git-ssh`, `gpg.ssh.program` → `ag-git-sign`.
 * Git runs `gpg.ssh.program` without a shell, so those two are argument-free
 * programs of their own (see `bin/`) rather than `ag git …` invocations.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { constants, homedir, tmpdir } from "node:os";
import { join } from "node:path";

export const KEYCHAIN_ITEM = "agent-git-ssh-key";

export const USAGE = `usage: ag git <subcommand>

  socket     ensure the agent, print its socket path
  ssh …      GIT_SSH_COMMAND target: ssh through the agent
  sign …     gpg.ssh.program target: ssh-keygen through the agent
  check      exit 0 when push auth and a test signature work
  import     store the private key read from stdin in the login keychain

Routing lives in the env block of the Claude Code settings file
(GIT_SSH_COMMAND, gpg.format, gpg.ssh.program, user.signingkey).`;

export class GitError extends Error {}

const die = (cause: string): never => {
  throw new GitError(cause);
};

const firstLine = (s: string) => s.trim().split("\n")[0] ?? "";

export const socketPath = () => join(tmpdir(), `agent-git-${process.getuid?.() ?? 0}.sock`);

type RunResult = { code: number; stdout: string; stderr: string };

function run(
  cmd: string[],
  opts: { env?: Record<string, string>; stdin?: string } = {},
): RunResult {
  const r = Bun.spawnSync(cmd, {
    env: { ...process.env, ...opts.env },
    stdin: opts.stdin === undefined ? "ignore" : Buffer.from(opts.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

/** Run a command against the agent at `sock`. */
const agentRun = (sock: string, cmd: string[], stdin?: string) =>
  run(cmd, { env: { SSH_AUTH_SOCK: sock }, stdin });

/** Replace this process with `cmd`, as far as bun allows: same stdio, same exit status. */
function exec(cmd: string[], env: Record<string, string> = {}): never {
  const r = Bun.spawnSync(cmd, {
    env: { ...process.env, ...env },
    stdio: ["inherit", "inherit", "inherit"],
  });
  // A child killed by a signal has no exit code; report it the way a shell does.
  const signal = r.signalCode as keyof typeof constants.signals | null;
  process.exit(signal ? 128 + constants.signals[signal] : r.exitCode);
}

// Exit code 2 from `ssh-add -l` means "cannot reach an agent"; 1 means alive
// but empty, which a fresh agent is.
const agentAlive = (sock: string) => agentRun(sock, ["ssh-add", "-l"]).code <= 1;
const agentHasKey = (sock: string) => agentRun(sock, ["ssh-add", "-l"]).code === 0;

function readKey(): string | null {
  const user = process.env.USER ?? "";
  const r = run(["security", "find-generic-password", "-a", user, "-s", KEYCHAIN_ITEM, "-w"]);
  if (r.code !== 0) return null;
  // `security -w` prints a value that contains newlines as one hex line.
  const raw = r.stdout.trim();
  return /^[0-9a-f]+$/.test(raw) ? Buffer.from(raw, "hex").toString() : `${raw}\n`;
}

function loadKey(sock: string) {
  const key =
    readKey() ?? die(`keychain item ${KEYCHAIN_ITEM} missing or unreadable — run: ag git import`);
  const r = agentRun(sock, ["ssh-add", "-q", "-"], key);
  if (r.code !== 0) die(`ssh-add refused the keychain key: ${firstLine(r.stderr)}`);
}

export function ensureAgent(): string {
  const sock = socketPath();
  if (agentHasKey(sock)) return sock;
  const lock = `${sock}.lock`;
  // Two sessions may start at once; the one that makes the lock dir starts
  // the agent, the other waits for it.
  try {
    mkdirSync(lock);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    for (let i = 0; i < 50; i++) {
      if (agentHasKey(sock)) return sock;
      Bun.sleepSync(100);
    }
    // The holder is gone (killed before its cleanup) or failed; the next
    // run must not wait on its lock again.
    rmSync(lock, { recursive: true, force: true });
    die("timed out waiting for another session to start the agent — run again");
  }
  try {
    if (!agentAlive(sock)) {
      rmSync(sock, { force: true });
      if (run(["ssh-agent", "-a", sock]).code !== 0) die(`cannot start ssh-agent at ${sock}`);
    }
    if (!agentHasKey(sock)) loadKey(sock);
  } finally {
    rmdirSync(lock);
  }
  return sock;
}

export function cmdSocket() {
  console.log(ensureAgent());
}

// The developer's ~/.ssh/config may point every host at another agent and
// restrict identities to its files; command-line options outrank the config.
const sshArgs = (sock: string) => ["-o", `IdentityAgent=${sock}`, "-o", "IdentitiesOnly=no"];

export function cmdSsh(args: string[]): never {
  exec(["ssh", ...sshArgs(ensureAgent()), ...args]);
}

export function cmdSign(args: string[]): never {
  // git passes: -Y sign -n git -f <pubkey file> <buffer>. With no private
  // key file beside the public one, ssh-keygen signs through SSH_AUTH_SOCK.
  exec(["ssh-keygen", ...args], { SSH_AUTH_SOCK: ensureAgent() });
}

// --- routing -------------------------------------------------------------

type Routing = {
  GIT_SSH_COMMAND?: string;
  "gpg.format"?: string;
  "gpg.ssh.program"?: string;
  "user.signingkey"?: string;
};

const settingsPath = () =>
  join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "settings.json");

export function readRouting(path = settingsPath()): Routing {
  if (!existsSync(path)) return {};
  let env: Record<string, string> = {};
  try {
    env = (JSON.parse(readFileSync(path, "utf8")) as { env?: Record<string, string> }).env ?? {};
  } catch (e) {
    die(`cannot parse ${path}: ${(e as Error).message}`);
  }
  const routing: Routing = {};
  if (env.GIT_SSH_COMMAND) routing.GIT_SSH_COMMAND = env.GIT_SSH_COMMAND;
  const count = Number(env.GIT_CONFIG_COUNT ?? 0);
  for (let i = 0; i < count; i++) {
    const key = env[`GIT_CONFIG_KEY_${i}`];
    const value = env[`GIT_CONFIG_VALUE_${i}`];
    if (key === "gpg.format" || key === "gpg.ssh.program" || key === "user.signingkey")
      routing[key] = value;
  }
  return routing;
}

type Routed = { sshCommand: string; signProgram: string };

function checkRouting(pubkey: string): Routed {
  const routing = readRouting();
  const missing: string[] = (
    ["GIT_SSH_COMMAND", "gpg.ssh.program", "user.signingkey"] as const
  ).filter((k) => !routing[k]);
  if (routing["gpg.format"] !== "ssh") missing.push("gpg.format=ssh");
  if (missing.length)
    die(`git routing missing in ${settingsPath()} env block: ${missing.join(", ")}`);
  const keyPart = (k: string) => k.split(" ").slice(0, 2).join(" ");
  if (keyPart(routing["user.signingkey"] ?? "") !== keyPart(pubkey)) {
    die(
      `user.signingkey in ${settingsPath()} is not the agent key (${keyPart(pubkey).slice(0, 40)}…)`,
    );
  }
  return {
    sshCommand: routing.GIT_SSH_COMMAND ?? "",
    signProgram: routing["gpg.ssh.program"] ?? "",
  };
}

// --- check ---------------------------------------------------------------

export type CheckResult = { ok: true; fingerprint: string } | { ok: false; cause: string };

/**
 * Prove that push auth and a test signature work through the programs the
 * settings file routes git to. The runner calls this before it claims a ticket.
 */
export function gitCheck(): CheckResult {
  try {
    const sock = ensureAgent();
    const pubkey = firstLine(agentRun(sock, ["ssh-add", "-L"]).stdout);
    const fingerprint = agentRun(sock, ["ssh-add", "-l"]).stdout.split(" ")[1] ?? "";
    const routed = checkRouting(pubkey);
    // Git runs GIT_SSH_COMMAND through the shell with ssh's arguments appended.
    const auth = run(["sh", "-c", `${routed.sshCommand} "$@"`, "sh", "-T", "git@github.com"]);
    const authOut = `${auth.stdout}${auth.stderr}`;
    if (!authOut.includes("successfully authenticated"))
      die(`GitHub auth failed: ${firstLine(authOut)}`);
    const tmp = mkdtempSync(join(tmpdir(), "ag-git-"));
    try {
      const pubFile = join(tmp, "key.pub");
      writeFileSync(pubFile, `${pubkey}\n`);
      const sig = run([routed.signProgram, "-Y", "sign", "-n", "git", "-f", pubFile], {
        stdin: "probe\n",
      });
      if (sig.code !== 0) die(`test signature failed: ${firstLine(sig.stderr)}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    return { ok: true, fingerprint };
  } catch (e) {
    if (e instanceof GitError) return { ok: false, cause: e.message };
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return { ok: false, cause: `routed program not found: ${(e as NodeJS.ErrnoException).path}` };
    throw e;
  }
}

export function cmdCheck() {
  const r = gitCheck();
  if (!r.ok) return die(r.cause);
  console.log(`ag git: push auth and signing OK (${r.fingerprint})`);
}

// --- import --------------------------------------------------------------

/**
 * Store the private key in the login keychain. Run once, with the secret
 * manager unlocked, for example:
 * `op read 'op://<vault>/<item>/private key?ssh-format=openssh' | ag git import`.
 * The key never touches argv or disk: it goes hex-encoded on stdin into `security -i`.
 */
export function cmdImport(stdin: string) {
  if (!stdin.trim())
    die("no key on stdin — pipe the private key, for example from the secret manager's CLI");
  const key = stdin.endsWith("\n") ? stdin : `${stdin}\n`;
  const hex = Buffer.from(key).toString("hex");
  const label = "agent-git (agent sessions SSH+signing key; source: the secret manager)";
  const user = process.env.USER ?? "";
  const line = `add-generic-password -a "${user}" -s ${KEYCHAIN_ITEM} -l "${label}" -X ${hex} -U\n`;
  const r = run(["security", "-i"], { stdin: line });
  if (r.code !== 0) die(`security refused the key: ${firstLine(r.stderr)}`);
  if (readKey() !== key) die("keychain round trip differs from the key on stdin");
  console.log(`ag git: key stored in the login keychain as ${KEYCHAIN_ITEM}`);
}

// --- dispatch ------------------------------------------------------------

export function gitMain(argv: string[]): never {
  const [sub, ...rest] = argv;
  try {
    switch (sub) {
      case "socket":
        cmdSocket();
        break;
      case "ssh":
        return cmdSsh(rest);
      case "sign":
        return cmdSign(rest);
      case "check":
        cmdCheck();
        break;
      case "import":
        cmdImport(readFileSync(0, "utf8"));
        break;
      default:
        console.error(USAGE);
        process.exit(2);
    }
  } catch (e) {
    if (!(e instanceof GitError)) throw e;
    console.error(`ag git: ${e.message}`);
    process.exit(1);
  }
  process.exit(0);
}
