import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  appendJsonLine,
  ensureDir,
  findRepoRoot,
  findRepoRootOptional,
  readJsonFile,
  readJsonLinesFile,
  writeJsonFile,
  writeJsonFileAsync,
  writeTextFile
} from "./index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ziniao-core-"));
  tempDirs.push(dir);
  return dir;
}

describe("file helpers", () => {
  it("finds repo roots strictly or optionally", () => {
    const root = tempRoot();
    ensureDir(path.join(root, "flows"));
    writeFileSync(path.join(root, "AGENTS.md"), "# rules\n");
    expect(findRepoRoot(path.join(root, "flows"))).toBe(root);
    expect(findRepoRootOptional(path.join(root, "flows"))).toBe(root);
    expect(findRepoRootOptional(tempRoot())).toBeUndefined();
  });

  it("creates nested directories and writes json", async () => {
    const root = tempRoot();
    const jsonPath = path.join(root, "a/b/value.json");
    writeJsonFile(jsonPath, { ok: true });
    expect(readJsonFile(jsonPath)).toEqual({ ok: true });

    const asyncPath = path.join(root, "a/c/value.json");
    await writeJsonFileAsync(asyncPath, { async: true });
    expect(readJsonFile(asyncPath)).toEqual({ async: true });
  });

  it("writes text and appends json lines", async () => {
    const root = tempRoot();
    const textPath = path.join(root, "logs/prompt.md");
    await writeTextFile(textPath, "hello");
    expect(readFileSync(textPath, "utf8")).toBe("hello");

    const jsonlPath = path.join(root, "logs/events.jsonl");
    await appendJsonLine(jsonlPath, { event: "one" });
    await appendJsonLine(jsonlPath, { event: "two" });
    expect(await readJsonLinesFile(jsonlPath)).toEqual([
      { event: "one" },
      { event: "two" }
    ]);
  });

  it("ensureDir is idempotent", () => {
    const dirPath = path.join(tempRoot(), "nested/dir");
    ensureDir(dirPath);
    ensureDir(dirPath);
    expect(readJsonLinesFile(path.join(dirPath, "missing.jsonl"))).resolves.toEqual([]);
  });
});
