#!/usr/bin/env bun
// GIT_SSH_COMMAND target. Git runs it with ssh's arguments appended.
import { gitMain } from "../git";

gitMain(["ssh", ...process.argv.slice(2)]);
