import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { badRequest } from "./errors.js";

export type AllowedRoot = "output" | "logs" | "flows" | "extracts" | "static";

export function resolveSafePath(
  roots: Record<AllowedRoot, string>,
  rootKey: AllowedRoot,
  relPath = ""
): string {
  const root = roots[rootKey];
  if (!root) {
    throw badRequest(`非法的根目录: ${rootKey}`);
  }
  let rel: string;
  try {
    rel = decodeURIComponent(relPath);
  } catch {
    rel = relPath;
  }
  rel = rel.trim().replace(/^[/\\]+/, "");
  if (rel.includes("\0")) {
    throw badRequest("路径包含非法字符");
  }
  const rootResolved = path.resolve(root);
  const candidate = path.resolve(rootResolved, rel);
  if (candidate !== rootResolved && !candidate.startsWith(`${rootResolved}${path.sep}`)) {
    throw badRequest(`路径越界: ${relPath}`);
  }
  return candidate;
}

export function isFile(filePath: string): boolean {
  return existsSync(filePath) && statSync(filePath).isFile();
}

export function isDirectory(filePath: string): boolean {
  return existsSync(filePath) && statSync(filePath).isDirectory();
}
