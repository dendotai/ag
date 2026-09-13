#!/usr/bin/env bun
// gpg.ssh.program target. Git runs it without a shell, so it cannot carry
// a subcommand argument; this file is that argument.
import { gitMain } from "../git";

gitMain(["sign", ...process.argv.slice(2)]);
