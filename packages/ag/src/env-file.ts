import { existsSync, readFileSync, writeFileSync } from "node:fs";

export type EnvValues = Record<string, string>;

export function parseEnvFile(path: string): EnvValues {
  if (!existsSync(path)) return {};
  const out: EnvValues = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) out[match[1] as string] = match[2] as string;
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
