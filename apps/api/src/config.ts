import { accessSync, constants, existsSync, readFileSync } from "node:fs";
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
export const DEFAULT_CODEX_CHAT_AGENT = "codex";
export const DEFAULT_CLAUDE_CHAT_AGENT = "claude";
export const DEFAULT_CLI_CHAT_TIMEOUT_SEC = 600;

export type WebAdminConfig = {
  repoRoot: string;
  dataRoot: string;
  host: typeof WEBADMIN_HOST;
  port: number;
  flowTimeoutMs: number;
  frontendDist: string;
};

export type CommandLocator = (command: string) => string | null;

export type WebAdminChatAgentConfig = {
  name: string;
  type: string;
  label: string;
  typeLabel: string;
  description?: string;
  icon?: string;
  source: "discovered" | "configured" | "overlay" | string;
  available: boolean;
  diagnostic?: { code: string; message: string };
  timeoutSec: number;
  capabilities: string[];
  gatewayUrl?: string;
  agentId?: string;
  sessionKeyPrefix?: string;
  token?: string;
  tokenPath?: string;
  command?: string[];
  cwd?: string;
  outputFormat?: "text" | "json";
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

export function getWebAdminChatConfig(repoRoot: string, options: { commandLocator?: CommandLocator } = {}): WebAdminChatConfig {
  const repoConfig = readRepoConfig(repoRoot);
  const webadmin = isRecord(repoConfig.webadmin) ? repoConfig.webadmin : {};
  const chat = isRecord(webadmin.chat) ? webadmin.chat : {};
  const configuredDefault = typeof chat.agent === "string" && chat.agent.trim()
    ? chat.agent.trim()
    : DEFAULT_OPENCLAW_CHAT_AGENT;
  const commandLocator = options.commandLocator ?? findExecutable;
  const rawAgents = isRecord(chat.agents) ? chat.agents : {};
  const agents: Record<string, WebAdminChatAgentConfig> = {
    [DEFAULT_OPENCLAW_CHAT_AGENT]: defaultOpenClawGatewayAgent(),
    [DEFAULT_CODEX_CHAT_AGENT]: defaultCodexAgent(commandLocator),
    [DEFAULT_CLAUDE_CHAT_AGENT]: defaultClaudeAgent(commandLocator)
  };

  for (const [name, value] of Object.entries(rawAgents)) {
    if (!isRecord(value)) continue;
    agents[name] = normalizeChatAgentConfig(name, value, agents[name], commandLocator);
  }

  const defaultAgent = agents[configuredDefault]?.available ? configuredDefault : firstAvailableAgent(agents) ?? DEFAULT_OPENCLAW_CHAT_AGENT;
  return { defaultAgent, agents };
}

function normalizeChatAgentConfig(
  name: string,
  value: Record<string, unknown>,
  discovered: WebAdminChatAgentConfig | undefined,
  commandLocator: CommandLocator
): WebAdminChatAgentConfig {
  const type = readString(value.type) ?? discovered?.type ?? "command-cli";
  const disabled = value.disabled === true;
  const base = discovered ?? defaultUnavailableConfiguredAgent(name, type);
  const timeoutSec = readPositiveNumber(value.timeout_sec) ?? readPositiveNumber(value.timeoutSec) ?? base.timeoutSec;
  const configuredCommand = readStringArray(value.command);
  const resolvedConfiguredCommand = configuredCommand
    ? resolveConfiguredCommand(configuredCommand, commandLocator)
    : undefined;
  const command = resolvedConfiguredCommand?.command ?? base.command;
  const next: WebAdminChatAgentConfig = {
    ...base,
    name,
    type,
    label: readString(value.label) ?? base.label ?? name,
    typeLabel: readString(value.type_label) ?? readString(value.typeLabel) ?? base.typeLabel ?? type,
    description: readString(value.description) ?? base.description,
    icon: readString(value.icon) ?? base.icon,
    timeoutSec,
    source: discovered ? "overlay" : "configured",
    capabilities: readStringArray(value.capabilities) ?? base.capabilities ?? ["chat"],
    gatewayUrl: readString(value.gateway_url) ?? readString(value.gatewayUrl) ?? base.gatewayUrl,
    agentId: readString(value.agent_id) ?? readString(value.agentId) ?? base.agentId,
    sessionKeyPrefix: readString(value.session_key_prefix) ?? readString(value.sessionKeyPrefix) ?? base.sessionKeyPrefix,
    token: readString(value.token) ?? base.token,
    tokenPath: readString(value.token_path) ?? readString(value.tokenPath) ?? base.tokenPath,
    command,
    cwd: readString(value.cwd) ?? base.cwd,
    outputFormat: readOutputFormat(value.output_format) ?? readOutputFormat(value.outputFormat) ?? base.outputFormat
  };
  if (disabled) {
    next.available = false;
    next.diagnostic = { code: "disabled", message: "Agent 已在 config.json 中禁用" };
  } else if (resolvedConfiguredCommand) {
    next.available = resolvedConfiguredCommand.available;
    next.diagnostic = resolvedConfiguredCommand.available
      ? undefined
      : { code: "command_missing", message: "未找到已配置的 Agent 命令" };
  } else {
    next.available = base.available;
    next.diagnostic = base.available ? undefined : base.diagnostic;
  }
  return next;
}

function defaultOpenClawGatewayAgent(): WebAdminChatAgentConfig {
  return {
    name: DEFAULT_OPENCLAW_CHAT_AGENT,
    type: "openclaw-gateway",
    label: "OpenClaw",
    typeLabel: "OpenClaw Gateway",
    description: "通过本机 OpenClaw Gateway RPC 对话",
    icon: "openclaw",
    source: "discovered",
    available: true,
    gatewayUrl: DEFAULT_OPENCLAW_GATEWAY_URL,
    agentId: DEFAULT_OPENCLAW_AGENT_ID,
    timeoutSec: DEFAULT_OPENCLAW_CHAT_TIMEOUT_SEC,
    sessionKeyPrefix: "auto-ziniao-webadmin:",
    capabilities: ["chat", "a2ui"]
  };
}

function defaultCodexAgent(commandLocator: CommandLocator): WebAdminChatAgentConfig {
  const commandPath = commandLocator("codex");
  return {
    name: DEFAULT_CODEX_CHAT_AGENT,
    type: "codex-cli",
    label: "Codex",
    typeLabel: "Codex CLI",
    description: "通过本机 codex exec 非交互命令对话",
    icon: "codex",
    source: "discovered",
    available: Boolean(commandPath),
    diagnostic: commandPath ? undefined : { code: "command_missing", message: "未在 PATH 中找到 codex 命令" },
    timeoutSec: DEFAULT_CLI_CHAT_TIMEOUT_SEC,
    capabilities: ["chat"],
    command: commandPath
      ? [commandPath, "exec", "--sandbox", "read-only", "{prompt}"]
      : ["codex", "exec", "--sandbox", "read-only", "{prompt}"],
    outputFormat: "text"
  };
}

function defaultClaudeAgent(commandLocator: CommandLocator): WebAdminChatAgentConfig {
  const commandPath = commandLocator("claude");
  return {
    name: DEFAULT_CLAUDE_CHAT_AGENT,
    type: "claude-code-cli",
    label: "Claude Code",
    typeLabel: "Claude Code CLI",
    description: "通过本机 Claude Code print 模式对话",
    icon: "claude",
    source: "discovered",
    available: Boolean(commandPath),
    diagnostic: commandPath ? undefined : { code: "command_missing", message: "未在 PATH 中找到 claude 命令" },
    timeoutSec: DEFAULT_CLI_CHAT_TIMEOUT_SEC,
    capabilities: ["chat"],
    command: commandPath
      ? [commandPath, "-p", "{prompt}", "--permission-mode", "plan", "--output-format", "text"]
      : ["claude", "-p", "{prompt}", "--permission-mode", "plan", "--output-format", "text"],
    outputFormat: "text"
  };
}

function defaultUnavailableConfiguredAgent(name: string, type: string): WebAdminChatAgentConfig {
  return {
    name,
    type,
    label: name,
    typeLabel: type,
    source: "configured",
    available: false,
    diagnostic: { code: "command_missing", message: "Agent 未自动发现，请在 config.json 中配置可执行 command" },
    timeoutSec: DEFAULT_CLI_CHAT_TIMEOUT_SEC,
    capabilities: ["chat"]
  };
}

function firstAvailableAgent(agents: Record<string, WebAdminChatAgentConfig>) {
  return Object.values(agents).find((agent) => agent.available)?.name;
}

function resolveConfiguredCommand(command: string[], commandLocator: CommandLocator) {
  const executable = command[0];
  if (!executable) return { command, available: false };
  const resolved = executable.includes(path.sep)
    ? canExecute(executable) ? executable : null
    : commandLocator(executable);
  return {
    command: resolved ? [resolved, ...command.slice(1)] : command,
    available: Boolean(resolved)
  };
}

function findExecutable(command: string): string | null {
  if (command.includes(path.sep)) {
    return canExecute(command) ? command : null;
  }
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    if (canExecute(candidate)) return candidate;
  }
  return null;
}

function canExecute(filePath: string) {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPositiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value.map((item) => item.trim()).filter(Boolean)
    : undefined;
}

function readOutputFormat(value: unknown): "text" | "json" | undefined {
  return value === "json" || value === "text" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
