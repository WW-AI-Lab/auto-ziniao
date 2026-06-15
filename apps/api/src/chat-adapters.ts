import { spawn } from "node:child_process";

import type { ChatA2UIBlock, ChatToolCall } from "@ww-ai-lab/auto-ziniao-schemas";
import type { WebAdminChatAgentConfig } from "./config.js";
import type { GatewayChatClient, GatewayChatResult } from "./openclaw-gateway.js";

export type ChatCommandRunResult = {
  exitCode: number;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  commandMissing?: boolean;
};

export type ChatCommandRunner = (input: {
  command: string[];
  cwd?: string;
  timeoutMs: number;
}) => Promise<ChatCommandRunResult>;

export type SendChatWithAgentInput = {
  agentName: string;
  agent: WebAdminChatAgentConfig;
  sessionId: string;
  content: string;
  messageId: number;
  repoRoot: string;
  gatewayClient: GatewayChatClient;
  commandRunner?: ChatCommandRunner;
};

const MAX_OUTPUT_CHARS = 20_000;
const MAX_DIAGNOSTIC_CHARS = 1_000;

export async function sendChatWithAgent(input: SendChatWithAgentInput): Promise<GatewayChatResult> {
  if (!input.agent.available) {
    throw chatAdapterError(input.agent, input.agent.diagnostic?.message ?? `Agent 不可用: ${input.agentName}`, {
      code: input.agent.diagnostic?.code ?? "agent_unavailable"
    });
  }
  if (input.agent.type === "openclaw-gateway") {
    const result = await input.gatewayClient.sendChat(input);
    return withAgentExtras(input.agent, result);
  }
  if (["codex-cli", "claude-code-cli", "command-cli"].includes(input.agent.type) || input.agent.command) {
    return runCommandAgent(input);
  }
  throw chatAdapterError(input.agent, `不支持的 Agent 类型: ${input.agent.type}`, { code: "unsupported_agent_type" });
}

export const defaultChatCommandRunner: ChatCommandRunner = (input) =>
  new Promise((resolve) => {
    if (input.command.length === 0) {
      resolve({ exitCode: 127, stderr: "agent command missing", commandMissing: true });
      return;
    }
    const child = spawn(input.command[0]!, input.command.slice(1), {
      cwd: input.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let settled = false;
    let stdout = "";
    let stderr = "";
    const finish = (result: ChatCommandRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ...result,
        stdout: truncate(stdout, MAX_OUTPUT_CHARS),
        stderr: truncate(result.stderr ?? stderr, MAX_DIAGNOSTIC_CHARS)
      });
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ exitCode: -1, timedOut: true });
    }, input.timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      finish({ exitCode: 127, stderr: error.message, commandMissing: true });
    });
    child.on("close", (code) => {
      finish({ exitCode: code ?? 0 });
    });
  });

async function runCommandAgent(input: SendChatWithAgentInput): Promise<GatewayChatResult> {
  const command = input.agent.command;
  if (!command?.length) {
    throw chatAdapterError(input.agent, "Agent command missing", { code: "command_missing", command_missing: true });
  }
  const rendered = renderCommand(command, {
    prompt: input.content,
    prompt_path: "",
    session_id: input.sessionId,
    session_key: `${input.agent.name}:${input.sessionId}`,
    agent: input.agent.name,
    repo_root: input.repoRoot
  });
  const runner = input.commandRunner ?? defaultChatCommandRunner;
  const result = await runner({
    command: rendered,
    cwd: input.agent.cwd ?? input.repoRoot,
    timeoutMs: input.agent.timeoutSec * 1000
  });
  if (result.exitCode !== 0 || result.timedOut || result.commandMissing) {
    throw chatAdapterError(input.agent, commandErrorMessage(result), {
      code: result.timedOut ? "timeout" : result.commandMissing ? "command_missing" : "command_failed",
      cli_exit_code: result.exitCode,
      cli_stderr: truncate(result.stderr ?? "", MAX_DIAGNOSTIC_CHARS),
      timed_out: Boolean(result.timedOut),
      command_missing: Boolean(result.commandMissing)
    });
  }
  const parsed = parseCommandOutput(input.agent, result.stdout ?? "");
  return withAgentExtras(input.agent, parsed);
}

function parseCommandOutput(agent: WebAdminChatAgentConfig, stdout: string): GatewayChatResult {
  const text = truncate(stdout.trim(), MAX_OUTPUT_CHARS);
  if (agent.outputFormat !== "json") {
    return { text: text || "OK" };
  }
  try {
    const parsed = JSON.parse(text) as {
      text?: unknown;
      reasoning?: unknown;
      tools?: unknown;
      a2ui?: unknown;
      runId?: unknown;
    };
    return {
      text: typeof parsed.text === "string" ? parsed.text : text || "OK",
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined,
      tools: Array.isArray(parsed.tools) ? parsed.tools.filter(isChatToolCall) : undefined,
      a2ui: Array.isArray(parsed.a2ui) ? parsed.a2ui.filter(isChatA2UIBlock) : undefined,
      runId: typeof parsed.runId === "string" ? parsed.runId : undefined,
      raw: parsed
    };
  } catch {
    return { text: text || "OK" };
  }
}

function withAgentExtras(agent: WebAdminChatAgentConfig, result: GatewayChatResult): GatewayChatResult {
  return {
    ...result,
    raw: result.raw,
    agent: agent.name,
    agentLabel: agent.label,
    agentType: agent.type
  } as GatewayChatResult;
}

function chatAdapterError(agent: WebAdminChatAgentConfig, message: string, diagnostic: Record<string, unknown>) {
  return Object.assign(new Error(message), {
    agent: agent.name,
    agentLabel: agent.label,
    agentType: agent.type,
    diagnostic,
    tools: [{ name: agent.name, status: "failed", error: message }]
  });
}

function commandErrorMessage(result: ChatCommandRunResult) {
  if (result.timedOut) return "Agent command timed out";
  if (result.commandMissing) return "Agent command missing";
  return truncate(result.stderr || `Agent command failed with exit code ${result.exitCode}`, MAX_DIAGNOSTIC_CHARS);
}

function renderCommand(command: string[], values: Record<string, string>) {
  return command.map((part) =>
    part.replace(/\{(prompt|prompt_path|session_id|session_key|agent|repo_root)\}/g, (_full, key: string) => values[key] ?? "")
  );
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function isChatToolCall(value: unknown): value is ChatToolCall {
  return Boolean(value && typeof value === "object" && typeof (value as { name?: unknown }).name === "string");
}

function isChatA2UIBlock(value: unknown): value is ChatA2UIBlock {
  return Boolean(value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string");
}
