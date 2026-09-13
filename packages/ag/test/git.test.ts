import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FINGERPRINT, makeSandbox, PRIVATE_KEY, ROUTING, type Sandbox } from "./stubs";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
  sb.routing(ROUTING);
  sb.storeKey();
});
afterEach(() => sb.cleanup());

describe("ag git check", () => {
  test("exits 0 with the fingerprint when auth and a signature work", () => {
    const r = sb.run(["git", "check"]);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(FINGERPRINT);
    expect(r.stdout.trim().split("\n")).toHaveLength(1);
  });

  test("starts the agent and loads the key from the keychain on first use", () => {
    sb.run(["git", "check"]);
    const calls = sb.calls();
    expect(calls.some((c) => c.startsWith(`ssh-agent -a ${sb.socket}`))).toBe(true);
    expect(calls.some((c) => c.startsWith("security find-generic-password"))).toBe(true);
    expect(calls).toContain(`ssh-add SSH_AUTH_SOCK=${sb.socket}`);
    expect(calls).toContain(
      `ssh -o IdentityAgent=${sb.socket} -o IdentitiesOnly=no -T git@github.com`,
    );
    expect(calls.some((c) => c.startsWith("ssh-keygen -Y sign -n git -f "))).toBe(true);
    expect(calls).toContain(`ssh-keygen SSH_AUTH_SOCK=${sb.socket}`);
  });

  test("reuses a running agent that already holds the key", () => {
    sb.run(["git", "check"]);
    const first = sb.calls().length;
    sb.run(["git", "check"]);
    const calls = sb.calls().slice(first);
    expect(calls.some((c) => c.startsWith("ssh-agent"))).toBe(false);
    expect(calls.some((c) => c.startsWith("security"))).toBe(false);
  });

  test("fails with a one-line cause when the keychain has no key", () => {
    sb.cleanup();
    sb = makeSandbox();
    sb.routing(ROUTING);
    const r = sb.run(["git", "check"]);
    expect(r.code).toBe(1);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    expect(r.stderr).toContain("ag git import");
  });

  test("fails with a one-line cause when GitHub refuses the key", () => {
    sb.fail("github");
    const r = sb.run(["git", "check"]);
    expect(r.code).toBe(1);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    expect(r.stderr).toContain("Permission denied");
  });

  test("fails with a one-line cause when the test signature fails", () => {
    sb.fail("sign");
    const r = sb.run(["git", "check"]);
    expect(r.code).toBe(1);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    expect(r.stderr).toContain("signature");
  });

  test("fails when the agent cannot start", () => {
    sb.fail("agent");
    const r = sb.run(["git", "check"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("ssh-agent");
  });

  test("reports missing routing in the Claude Code settings file", () => {
    sb.routing({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "gpg.format",
      GIT_CONFIG_VALUE_0: "ssh",
    });
    const r = sb.run(["git", "check"]);
    expect(r.code).toBe(1);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    expect(r.stderr).toContain("GIT_SSH_COMMAND");
    expect(r.stderr).toContain("gpg.ssh.program");
    expect(r.stderr).toContain("user.signingkey");
  });

  test("reports routing when the settings file is absent", () => {
    sb.routing(null);
    const r = sb.run(["git", "check"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("GIT_SSH_COMMAND");
  });

  test("reports a signing key that is not the agent's key", () => {
    sb.routing({ ...ROUTING, GIT_CONFIG_VALUE_2: "ssh-ed25519 AAAAother" });
    const r = sb.run(["git", "check"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("user.signingkey");
  });
});

describe("ag git socket", () => {
  test("prints the socket path after ensuring the agent", () => {
    const r = sb.run(["git", "socket"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(sb.socket);
    expect(sb.calls().some((c) => c.startsWith("ssh-agent"))).toBe(true);
  });
});

describe("ag git ssh / sign", () => {
  test("ssh runs ssh through the agent with the given arguments", () => {
    const r = sb.run(["git", "ssh", "git@github.com", "git-upload-pack 'x/y.git'"]);
    expect(r.code).toBe(1);
    expect(sb.calls()).toContain(
      `ssh -o IdentityAgent=${sb.socket} git@github.com git-upload-pack 'x/y.git'`,
    );
  });

  test("sign runs ssh-keygen with the agent as SSH_AUTH_SOCK", () => {
    const r = sb.run(["git", "sign", "-Y", "sign", "-n", "git", "-f", "/k.pub"], {
      stdin: "buffer",
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("BEGIN SSH SIGNATURE");
    expect(sb.calls()).toContain("ssh-keygen -Y sign -n git -f /k.pub");
    expect(sb.calls()).toContain(`ssh-keygen SSH_AUTH_SOCK=${sb.socket}`);
  });

  test("ag-git-ssh and ag-git-sign are argument-free entry points", () => {
    const ssh = sb.run(["git@github.com"], { program: "ag-git-ssh.ts" });
    expect(ssh.code).toBe(1);
    expect(sb.calls()).toContain(`ssh -o IdentityAgent=${sb.socket} git@github.com`);
    const sign = sb.run(["-Y", "sign"], { program: "ag-git-sign.ts", stdin: "" });
    expect(sign.code).toBe(0);
    expect(sb.calls()).toContain("ssh-keygen -Y sign");
  });
});

describe("ag git import", () => {
  test("stores the key from stdin in the keychain and verifies the round trip", () => {
    sb.cleanup();
    sb = makeSandbox();
    const r = sb.run(["git", "import"], { stdin: PRIVATE_KEY });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(sb.keychain()).toBe(PRIVATE_KEY);
    const add = sb.calls().find((c) => c.startsWith("security-i"));
    expect(add).toContain('add-generic-password -a "ag-test" -s agent-git-ssh-key');
    expect(add).not.toContain("BEGIN");
  });

  test("refuses an empty stdin", () => {
    const r = sb.run(["git", "import"], { stdin: "" });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("stdin");
  });

  test("a key read back from a hex-encoded keychain value loads unchanged", () => {
    sb.run(["git", "check"]);
    expect(Bun.file(`${sb.dir}/loaded-key`).text()).resolves.toBe(PRIVATE_KEY);
  });
});

describe("usage", () => {
  test("ag git with no subcommand prints usage and exits 2", () => {
    const r = sb.run(["git"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("check");
    expect(r.stderr).toContain("import");
  });
});
