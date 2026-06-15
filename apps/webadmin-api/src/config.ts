import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { defaultRepoRoot } from "@ziniao/core";

export const WEBADMIN_HOST = "127.0.0.1";
export const DEFAULT_WEBADMIN_PORT = 9482;
export const DEFAULT_FLOW_TIMEOUT_MS = 30 * 60 * 1000;
export const PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

export type WebAdminConfig = {
  repoRoot: string;
  dataRoot: string;
  host: typeof WEBADMIN_HOST;
  port: number;
  flowTimeoutMs: number;
  frontendDist: string;
};

export function readRepoConfig(repoRoot: string): Record<string, unknown> {
  const configPath = path.join(repoRoot, "config.json");
  if (!existsSync(configPath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function createConfig(input: Partial<WebAdminConfig> = {}): WebAdminConfig {
  const repoRoot = input.repoRoot ?? defaultRepoRoot;
  const repoConfig = readRepoConfig(repoRoot);
  const webadmin = isRecord(repoConfig.webadmin) ? repoConfig.webadmin : {};
  const rawPort = input.port ?? webadmin.port ?? DEFAULT_WEBADMIN_PORT;
  const port = Number.isInteger(Number(rawPort)) ? Number(rawPort) : DEFAULT_WEBADMIN_PORT;
  return {
    repoRoot,
    dataRoot: input.dataRoot ?? path.join(repoRoot, "data"),
    host: WEBADMIN_HOST,
    port,
    flowTimeoutMs: input.flowTimeoutMs ?? DEFAULT_FLOW_TIMEOUT_MS,
    frontendDist: input.frontendDist ?? path.join(repoRoot, "webadmin", "frontend", "dist")
  };
}

export function getHealConfig(repoRoot: string): {
  defaultAgent: string;
  agents: Record<string, { command?: string[]; timeout_sec?: number }>;
} {
  const repoConfig = readRepoConfig(repoRoot);
  const heal = isRecord(repoConfig.heal) ? repoConfig.heal : {};
  const agents = isRecord(heal.agents) ? heal.agents : {};
  return {
    defaultAgent: typeof heal.agent === "string" ? heal.agent : "openclaw",
    agents: agents as Record<string, { command?: string[]; timeout_sec?: number }>
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
