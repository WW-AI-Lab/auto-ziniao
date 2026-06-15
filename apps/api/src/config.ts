import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { defaultRepoRoot } from "@ww-ai-lab/auto-ziniao-core";

export const WEBADMIN_HOST = "127.0.0.1";
export const DEFAULT_WEBADMIN_PORT = 9482;
export const DEFAULT_FLOW_TIMEOUT_MS = 30 * 60 * 1000;
export const PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
export const DEFAULT_OPENCLAW_GATEWAY_URL = "ws://127.0.0.1:18789";
export const DEFAULT_OPENCLAW_CHAT_AGENT = "openclaw";
export const DEFAULT_OPENCLAW_AGENT_ID = "main";
export const DEFAULT_OPENCLAW_CHAT_TIMEOUT_SEC = 320;

export type WebAdminConfig = {
  repoRoot: string;
  dataRoot: string;
  host: typeof WEBADMIN_HOST;
  port: number;
  flowTimeoutMs: number;
  frontendDist: string;
};

export type WebAdminChatAgentConfig = {
  type: "openclaw-gateway";
  gatewayUrl: string;
  agentId: string;
  timeoutSec: number;
  sessionKeyPrefix: string;
  token?: string;
  tokenPath?: string;
};

export type WebAdminChatConfig = {
  defaultAgent: string;
  agents: Record<string, WebAdminChatAgentConfig>;
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
    frontendDist: input.frontendDist ?? path.join(repoRoot, "apps", "web", "dist")
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

export function getWebAdminChatConfig(repoRoot: string): WebAdminChatConfig {
  const repoConfig = readRepoConfig(repoRoot);
  const webadmin = isRecord(repoConfig.webadmin) ? repoConfig.webadmin : {};
  const chat = isRecord(webadmin.chat) ? webadmin.chat : {};
  const defaultAgent = typeof chat.agent === "string" && chat.agent.trim()
    ? chat.agent.trim()
    : DEFAULT_OPENCLAW_CHAT_AGENT;
  const rawAgents = isRecord(chat.agents) ? chat.agents : {};
  const agents = Object.fromEntries(
    Object.entries(rawAgents).flatMap(([name, value]) => {
      if (!isRecord(value)) return [];
      return [[name, normalizeChatAgentConfig(value)]];
    })
  ) as Record<string, WebAdminChatAgentConfig>;
  if (!agents[defaultAgent]) {
    agents[defaultAgent] = defaultOpenClawGatewayAgent();
  }
  return { defaultAgent, agents };
}

function normalizeChatAgentConfig(value: Record<string, unknown>): WebAdminChatAgentConfig {
  return {
    type: "openclaw-gateway",
    gatewayUrl: readString(value.gateway_url) ?? readString(value.gatewayUrl) ?? DEFAULT_OPENCLAW_GATEWAY_URL,
    agentId: readString(value.agent_id) ?? readString(value.agentId) ?? DEFAULT_OPENCLAW_AGENT_ID,
    timeoutSec: readPositiveNumber(value.timeout_sec) ?? readPositiveNumber(value.timeoutSec) ?? DEFAULT_OPENCLAW_CHAT_TIMEOUT_SEC,
    sessionKeyPrefix: readString(value.session_key_prefix) ?? readString(value.sessionKeyPrefix) ?? "auto-ziniao-webadmin:",
    token: readString(value.token),
    tokenPath: readString(value.token_path) ?? readString(value.tokenPath)
  };
}

function defaultOpenClawGatewayAgent(): WebAdminChatAgentConfig {
  return {
    type: "openclaw-gateway",
    gatewayUrl: DEFAULT_OPENCLAW_GATEWAY_URL,
    agentId: DEFAULT_OPENCLAW_AGENT_ID,
    timeoutSec: DEFAULT_OPENCLAW_CHAT_TIMEOUT_SEC,
    sessionKeyPrefix: "auto-ziniao-webadmin:"
  };
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPositiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
