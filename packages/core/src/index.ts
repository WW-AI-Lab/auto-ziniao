import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export class ZiniaoError extends Error {
  constructor(
    message: string,
    readonly code = "ziniao_error",
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ZiniaoError";
  }
}

export type JsonObject = Record<string, unknown>;

const currentFile = fileURLToPath(import.meta.url);

export function findRepoRoot(startDir = process.cwd()): string {
  let current = path.resolve(startDir);
  while (true) {
    if (
      existsSync(path.join(current, "AGENTS.md")) &&
      existsSync(path.join(current, "flows"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new ZiniaoError(
        `无法定位仓库根目录: ${startDir}`,
        "repo_root_not_found"
      );
    }
    current = parent;
  }
}

export const defaultRepoRoot = findRepoRoot(path.dirname(currentFile));

export function repoPath(...segments: string[]): string {
  return path.join(defaultRepoRoot, ...segments);
}

export function readJsonFile<T = unknown>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

export async function readJsonFileAsync<T = unknown>(
  filePath: string
): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export function readJsonLines<T = unknown>(content: string): T[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export async function readJsonLinesFile<T = unknown>(
  filePath: string
): Promise<T[]> {
  if (!existsSync(filePath)) {
    return [];
  }
  return readJsonLines<T>(await readFile(filePath, "utf8"));
}

export async function listJsonFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

export function nowIso(): string {
  return new Date().toISOString();
}
