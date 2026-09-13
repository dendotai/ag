#!/usr/bin/env bun
// `ag` — subcommand dispatch. Each subcommand is imported on demand: the stop
// hook runs at the end of every session turn and must start fast.
const usage = `usage: ag <command>

  dash        local dashboard over the runner's tickets, sessions, branches and PRs
  stop-hook   Stop hook of a runner session (reads the hook JSON on stdin)
`;

const command = process.argv[2];

switch (command) {
  case "dash":
    await (await import("./dash/serve.ts")).dashMain();
    break;
  case "stop-hook":
    await (await import("./stop-hook.ts")).stopHookMain();
    break;
  case undefined:
  case "-h":
  case "--help":
  case "help":
    process.stdout.write(usage);
    break;
  default:
    process.stderr.write(`ag: unknown command "${command}"\n\n${usage}`);
    process.exit(2);
}
