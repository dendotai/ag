import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cliPath = join(import.meta.dir, "..", "src", "cli.ts");
const binDir = join(import.meta.dir, "..", "src", "bin");

export const PUBKEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIStubStubStubStubStubStubStubStubStubStubStub ag-test";
export const FINGERPRINT = "SHA256:stubfingerprintstubfingerprintstubfingerprint";
export const PRIVATE_KEY =
  "-----BEGIN OPENSSH PRIVATE KEY-----\nc3R1Yg==\n-----END OPENSSH PRIVATE KEY-----\n";

export type Sandbox = ReturnType<typeof makeSandbox>;

/**
 * A sandbox with fake `ssh-agent`, `ssh-add`, `ssh`, `ssh-keygen` and
 * `security` first on PATH. Their state lives in files under `dir`, so a
 * test can arrange the keychain, the agent and GitHub's answer, and read
 * back every invocation from `calls`.
 */
export function makeSandbox() {
  const dir = mkdtempSync(join(tmpdir(), "ag-git-"));
  const bin = join(dir, "bin");
  const tmp = join(dir, "tmp");
  const claude = join(dir, "claude");
  mkdirSync(bin);
  mkdirSync(tmp);
  mkdirSync(claude);

  const stub = (name: string, body: string) => {
    const path = join(bin, name);
    writeFileSync(path, `#!/bin/sh\necho "${name} $*" >> "$STUB_DIR/calls.log"\n${body}`);
    chmodSync(path, 0o755);
  };

  // State files: agent-state (absent = no agent, "empty", "loaded"),
  // keychain (the stored private key), github-fail, sign-fail.
  stub(
    "ssh-agent",
    `[ -e "$STUB_DIR/agent-fail" ] && exit 1
echo empty > "$STUB_DIR/agent-state"
sock=""; while [ $# -gt 0 ]; do [ "$1" = -a ] && sock=$2; shift; done
: > "$sock"
echo "SSH_AUTH_SOCK=$sock; export SSH_AUTH_SOCK;"`,
  );
  stub(
    "ssh-add",
    `echo "ssh-add SSH_AUTH_SOCK=$SSH_AUTH_SOCK" >> "$STUB_DIR/calls.log"
state=$(cat "$STUB_DIR/agent-state" 2>/dev/null || echo none)
case "$1" in
  -l) case $state in none) exit 2;; empty) exit 1;; esac
      echo "256 ${FINGERPRINT} ag-test (ED25519)"; exit 0;;
  -L) [ "$state" = loaded ] || exit 1; echo "${PUBKEY}"; exit 0;;
  -q) cat > "$STUB_DIR/loaded-key"; echo loaded > "$STUB_DIR/agent-state"; exit 0;;
esac
exit 3`,
  );
  stub(
    "ssh",
    `if [ -e "$STUB_DIR/github-fail" ]; then echo "git@github.com: Permission denied (publickey)." >&2; exit 255; fi
echo "Hi ag-test! You've successfully authenticated, but GitHub does not provide shell access." >&2
exit 1`,
  );
  stub(
    "ssh-keygen",
    `echo "ssh-keygen SSH_AUTH_SOCK=$SSH_AUTH_SOCK" >> "$STUB_DIR/calls.log"
[ -e "$STUB_DIR/sign-fail" ] && { echo "Couldn't find key" >&2; exit 255; }
cat > /dev/null
echo "-----BEGIN SSH SIGNATURE-----"; echo stub; echo "-----END SSH SIGNATURE-----"`,
  );
  // \`security -w\` prints a value that contains newlines as one hex line.
  stub(
    "security",
    `case "$1" in
  find-generic-password)
    [ -e "$STUB_DIR/keychain" ] || { echo "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain." >&2; exit 44; }
    od -An -v -tx1 "$STUB_DIR/keychain" | tr -d ' \\n'; echo;;
  -i)
    line=$(cat)
    echo "security-i $line" >> "$STUB_DIR/calls.log"
    hex=$(printf '%s' "$line" | sed -n 's/.* -X \\([0-9a-f]*\\) .*/\\1/p')
    printf '%s' "$hex" | xxd -r -p > "$STUB_DIR/keychain";;
esac
exit 0`,
  );

  const env = {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    HOME: dir,
    USER: "ag-test",
    TMPDIR: tmp,
    STUB_DIR: dir,
    CLAUDE_CONFIG_DIR: claude,
    FINGERPRINT,
    PUBKEY,
  };

  const sb = {
    dir,
    socket: join(tmp, `agent-git-${process.getuid?.() ?? 0}.sock`),
    env,
    storeKey(key = PRIVATE_KEY) {
      writeFileSync(join(dir, "keychain"), key);
    },
    clearKey() {
      rmSync(join(dir, "keychain"), { force: true });
    },
    routing(envBlock: Record<string, string> | null) {
      writeFileSync(
        join(claude, "settings.json"),
        JSON.stringify(envBlock === null ? {} : { env: envBlock }),
      );
    },
    fail(what: "github" | "sign" | "agent") {
      writeFileSync(join(dir, `${what}-fail`), "");
    },
    /** Leave a lock dir behind, as a session killed while starting the agent would. */
    staleLock() {
      mkdirSync(`${this.socket}.lock`);
    },
    calls(): string[] {
      try {
        return readFileSync(join(dir, "calls.log"), "utf8").trim().split("\n");
      } catch {
        return [];
      }
    },
    keychain(): string | null {
      try {
        return readFileSync(join(dir, "keychain"), "utf8");
      } catch {
        return null;
      }
    },
    run(args: string[], opts: { stdin?: string; program?: string } = {}) {
      const program = opts.program ? join(binDir, opts.program) : cliPath;
      const r = Bun.spawnSync(["bun", program, ...args], {
        env,
        stdin: opts.stdin === undefined ? "ignore" : Buffer.from(opts.stdin),
        stdout: "pipe",
        stderr: "pipe",
      });
      return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return sb;
}

// The settings file routes git to the bin entries under test, which reach
// the stub ssh and ssh-keygen through PATH.
export const ROUTING = {
  GIT_SSH_COMMAND: join(binDir, "ag-git-ssh.ts"),
  GIT_CONFIG_COUNT: "3",
  GIT_CONFIG_KEY_0: "gpg.format",
  GIT_CONFIG_VALUE_0: "ssh",
  GIT_CONFIG_KEY_1: "gpg.ssh.program",
  GIT_CONFIG_VALUE_1: join(binDir, "ag-git-sign.ts"),
  GIT_CONFIG_KEY_2: "user.signingkey",
  GIT_CONFIG_VALUE_2: PUBKEY,
};
