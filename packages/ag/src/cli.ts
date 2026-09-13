#!/usr/bin/env bun
import { gitMain } from "./git";

const USAGE = `usage: ag <command> …

  git <subcommand>   push auth and commit signing through the agent-only key`;

const [command, ...rest] = process.argv.slice(2);
if (command === "git") gitMain(rest);
console.error(USAGE);
process.exit(2);
