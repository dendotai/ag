// A throwaway project with an `ag.config.ts` and a fake `convex` in its
// node_modules/.bin. The fake keeps its deployments in a JSON file and writes
// the same `.env.local` lines the real CLI writes on select. Every call is
// appended to calls.jsonl, so a test asserts the commands issued and nothing else.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const CONFIG = `export default {
  adapter: "convex",
  convex: { apiDir: "packages/api", team: "acme", project: "acme-com" },
  env: ({ secret }) => ({ APP_SECRET: secret(), MODE: "dev" }),
  files: ({ url }) => ({
    "apps/web/.env.local": { VITE_BACKEND_URL: url },
    "apps/web/.dev.vars": { BACKEND_URL: url },
  }),
};
`;

const FAKE_CONVEX = `
import { existsSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const stateDir = process.argv[2];
const statePath = join(stateDir, "deployments.json");
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { next: 1, deployments: {} };
const save = () => writeFileSync(statePath, JSON.stringify(state));
const args = process.argv.slice(3);
appendFileSync(join(stateDir, "calls.jsonl"), JSON.stringify({ args, cwd: process.cwd() }) + "\\n");

const fail = (message) => { console.error(message); process.exit(1); };
const parseSelector = (selector) => {
  const [team, project, ref] = selector.split(":");
  if (ref === undefined) fail("fake convex: selectors must be team:project:ref");
  if (!/^[a-z0-9/-]+$/.test(ref)) fail("fake convex: invalid reference " + ref);
  return { team, project, ref };
};
const find = ({ ref }) => Object.values(state.deployments).find((d) => d.ref === ref);
const select = (d) =>
  writeFileSync(
    ".env.local",
    "# Deployment used by \`npx convex dev\`\\n" +
      "CONVEX_DEPLOYMENT=dev:" + d.name + " # team: " + d.team + ", project: " + d.project + "\\n\\n" +
      "CONVEX_URL=https://" + d.name + ".convex.cloud\\n\\n" +
      "CONVEX_SITE_URL=https://" + d.name + ".convex.site\\n",
  );
const selected = () => {
  if (!existsSync(".env.local")) fail("fake convex: no deployment selected");
  const name = readFileSync(".env.local", "utf8").match(/^CONVEX_DEPLOYMENT=dev:(\\S+)/m)?.[1];
  const d = name && state.deployments[name];
  if (!d) fail("fake convex: selected deployment " + name + " is gone");
  return d;
};

const [command, sub, ...rest] = args;
if (command === "deployment" && sub === "select") {
  const target = parseSelector(rest[0]);
  const d = find(target);
  if (!d) fail("Deployment \\u201c" + target.ref + "\\u201d not found.");
  select(d);
} else if (command === "deployment" && sub === "create") {
  const target = parseSelector(rest[0]);
  if (existsSync(join(stateDir, "fail-create"))) fail("fake convex: create refused");
  if (find(target)) fail("fake convex: " + target.ref + " already exists");
  const name = "fake-" + target.ref.replace(/[^a-z0-9]+/g, "-") + "-" + state.next++;
  const expiration = rest.includes("--expiration") ? rest[rest.indexOf("--expiration") + 1] : null;
  const d = { ...target, name, expiration, vars: {} };
  state.deployments[name] = d;
  save();
  if (rest.includes("--select")) select(d);
} else if (command === "env" && sub === "list") {
  console.log(Object.keys(selected().vars).join("\\n"));
} else if (command === "env" && sub === "set") {
  const d = selected();
  d.vars[rest[0]] = rest[1];
  save();
} else if (command === "dev" && sub === "--once") {
  selected();
} else {
  fail("fake convex: unexpected command " + args.join(" "));
}
`;

const FILES: Record<string, string> = {
  "package.json": '{ "name": "acme-com", "workspaces": ["apps/*", "packages/*"] }\n',
  "packages/api/package.json": '{ "name": "@acme/api" }\n',
  "apps/web/package.json": '{ "name": "@acme/web" }\n',
  "ag.config.ts": CONFIG,
  ".gitignore": ".env.local\n.dev.vars\nnode_modules\n",
};

export interface Deployment {
  ref: string;
  name: string;
  expiration: string | null;
  vars: Record<string, string>;
}

export interface Project {
  /** Holds the project root, the fake's state, and any worktrees a test adds. */
  dir: string;
  root: string;
  calls(): string[][];
  clearCalls(): void;
  deployments(): Deployment[];
  /** The one deployment the fake holds; throws when there is none or several. */
  deployment(): Deployment;
  setVars(vars: Record<string, string>): void;
  expire(ref: string): void;
  refuseCreate(): void;
  cleanup(): void;
}

export function makeProject(): Project {
  const dir = mkdtempSync(join(tmpdir(), "ag-convex-"));
  const root = join(dir, "main");
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const state = join(dir, "state");
  mkdirSync(state);
  const bin = join(root, "node_modules/.bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "fake-convex.mjs"), FAKE_CONVEX);
  writeFileSync(
    join(bin, "convex"),
    `#!/bin/sh\nexec "${process.execPath}" "${bin}/fake-convex.mjs" "${state}" "$@"\n`,
  );
  chmodSync(join(bin, "convex"), 0o755);

  const statePath = join(state, "deployments.json");
  const readState = () =>
    JSON.parse(readFileSync(statePath, "utf8")) as { deployments: Record<string, Deployment> };
  return {
    dir,
    root,
    calls() {
      const path = join(state, "calls.jsonl");
      if (!existsSync(path)) return [];
      return readFileSync(path, "utf8")
        .trim()
        .split("\n")
        .map((line) => (JSON.parse(line) as { args: string[] }).args);
    },
    clearCalls() {
      rmSync(join(state, "calls.jsonl"), { force: true });
    },
    deployments() {
      return Object.values(readState().deployments);
    },
    deployment() {
      const all = Object.values(readState().deployments);
      const [only] = all;
      if (only === undefined || all.length !== 1) {
        throw new Error(`expected one deployment, found ${all.length}`);
      }
      return only;
    },
    setVars(vars) {
      const data = readState();
      for (const d of Object.values(data.deployments)) d.vars = vars;
      writeFileSync(statePath, JSON.stringify(data));
    },
    expire(ref) {
      const data = readState();
      for (const [name, d] of Object.entries(data.deployments)) {
        if (d.ref === ref) delete data.deployments[name];
      }
      writeFileSync(statePath, JSON.stringify(data));
    },
    refuseCreate() {
      writeFileSync(join(state, "fail-create"), "");
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function withProject(fn: (project: Project) => void | Promise<void>) {
  const project = makeProject();
  try {
    await fn(project);
  } finally {
    project.cleanup();
  }
}

export const readEnv = (dir: string, path: string) => readFileSync(join(dir, path), "utf8");
export const envValue = (text: string, key: string) =>
  text.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1];
export const callsNamed = (calls: string[][], ...prefix: string[]) =>
  calls.filter((args) => prefix.every((word, i) => args[i] === word));
