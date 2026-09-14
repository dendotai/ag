import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnvFile, upsertEnvFile } from "./env-file.ts";

function withDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "ag-env-file-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("upsertEnvFile", () => {
  test("creates the file with one line per entry", () =>
    withDir((dir) => {
      const path = join(dir, ".env.local");
      upsertEnvFile(path, { PORT: "3001", VITE_URL: "https://x.convex.cloud" });
      expect(readFileSync(path, "utf8")).toBe("PORT=3001\nVITE_URL=https://x.convex.cloud\n");
    }));

  test("replaces the line of a key that exists and keeps every other line", () =>
    withDir((dir) => {
      const path = join(dir, ".dev.vars");
      writeFileSync(path, "# keep this comment\nURL=old\nCLOUDFLARE_API_TOKEN=keep-me");
      upsertEnvFile(path, { URL: "new", EXTRA: "1" });
      expect(readFileSync(path, "utf8")).toBe(
        "# keep this comment\nURL=new\nCLOUDFLARE_API_TOKEN=keep-me\nEXTRA=1\n",
      );
    }));
});

describe("parseEnvFile", () => {
  test("returns an empty map for a missing file", () =>
    withDir((dir) => {
      expect(parseEnvFile(join(dir, "nope"))).toEqual({});
    }));

  test("reads KEY=value lines and skips the rest", () =>
    withDir((dir) => {
      const path = join(dir, ".env.local");
      writeFileSync(path, "# c\nURL=https://x\nEMPTY=\nnot a line\n");
      expect(parseEnvFile(path)).toEqual({ URL: "https://x", EMPTY: "" });
    }));
});
