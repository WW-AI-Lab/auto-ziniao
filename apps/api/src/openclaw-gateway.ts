import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { ChatA2UIBlock, ChatToolCall } from "@ww-ai-lab/auto-ziniao-schemas";
import type { WebAdminChatAgentConfig } from "./config.js";

export type GatewayChatInput = {
  agentName: string;
  agent: WebAdminChatAgentConfig;
  sessionId: string;
  content: string;
  messageId: number;
};

export type GatewayChatResult = {
  text: string;
  reasoning?: string;
  tools?: ChatToolCall[];
  a2ui?: ChatA2UIBlock[];
  runId?: string;
  raw?: unknown;
};

export type GatewayChatClient = {
  sendChat(input: GatewayChatInput): Promise<GatewayChatResult>;
};

type WebSocketConstructorLike = new (url: string) => WebSocketLike;

type WebSocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: WebSocketEventLike) => void, options?: { once?: boolean }): void;
  removeEventListener(type: "open" | "message" | "error" | "close", listener: (event: WebSocketEventLike) => void): void;
};

type WebSocketEventLike = {
  data?: unknown;
  error?: unknown;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  expectFinal: boolean;
};

const OPEN = 1;

export class OpenClawGatewayRpcChatClient implements GatewayChatClient {
  async sendChat(input: GatewayChatInput): Promise<GatewayChatResult> {
    const timeoutMs = input.agent.timeoutSec * 1000;
    const rpc = new GatewayRpcConnection({
      url: input.agent.gatewayUrl,
      token: resolveGatewayToken(input.agent)
    });
    try {
      await rpc.connect(Math.min(timeoutMs, 30_000));
      const response = await rpc.request("agent", {
        message: input.content,
        agentId: input.agent.agentId,
        sessionKey: buildSessionKey(input.agent, input.sessionId),
        deliver: false,
        timeout: input.agent.timeoutSec,
        idempotencyKey: `auto-ziniao-webadmin:${input.sessionId}:${input.messageId}`
      }, timeoutMs, true);
      return {
        text: extractGatewayText(response),
        runId: readString((response as { runId?: unknown }).runId),
        raw: response
      };
    } finally {
      rpc.close();
    }
  }
}

function buildSessionKey(agent: WebAdminChatAgentConfig, sessionId: string) {
  return `agent:${agent.agentId}:${agent.sessionKeyPrefix}${sessionId}`;
}

function resolveGatewayToken(agent: WebAdminChatAgentConfig) {
  if (agent.token) return agent.token;
  const configPath = agent.tokenPath
    ? resolveUserPath(agent.tokenPath)
    : path.join(homedir(), ".openclaw", "openclaw.json");
  if (!existsSync(configPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    const gateway = isRecord(parsed.gateway) ? parsed.gateway : {};
    const auth = isRecord(gateway.auth) ? gateway.auth : {};
    const remote = isRecord(gateway.remote) ? gateway.remote : {};
    return readString(auth.token) ?? readString(remote.token);
  } catch {
    return undefined;
  }
}

function resolveUserPath(value: string) {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
  return value;
}

class GatewayRpcConnection {
  private ws: WebSocketLike | null = null;
  private pending = new Map<string, PendingRequest>();
  private challengeNonce: string | null = null;
  private challengeResolve: ((nonce: string) => void) | null = null;
  private challengeReject: ((error: Error) => void) | null = null;

  constructor(private readonly options: { url: string; token?: string }) {}

  async connect(timeoutMs: number): Promise<void> {
    const WebSocketCtor = (globalThis as unknown as { WebSocket?: WebSocketConstructorLike }).WebSocket;
    if (!WebSocketCtor) throw new Error("OpenClaw Gateway RPC requires Node.js WebSocket support");
    this.ws = new WebSocketCtor(this.options.url);
    this.ws.addEventListener("message", this.onMessage);
    await this.waitForOpen(timeoutMs);
    const nonce = await this.waitForChallenge(timeoutMs);
    if (!nonce) throw new Error("OpenClaw Gateway connect challenge missing nonce");
    await this.request("connect", {
      minProtocol: 4,
      maxProtocol: 4,
      client: {
        id: "gateway-client",
        displayName: "ziniao-webadmin",
        version: "0.1.0",
        platform: process.platform,
        mode: "backend"
      },
      caps: [],
      auth: this.options.token ? { token: this.options.token } : undefined,
      role: "operator",
      scopes: ["operator.admin"]
    }, timeoutMs, false);
  }

  async request(method: string, params: unknown, timeoutMs: number, expectFinal: boolean): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== OPEN) throw new Error("OpenClaw Gateway is not connected");
    const id = randomUUID();
    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`OpenClaw Gateway RPC timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, expectFinal });
    });
    this.ws.send(JSON.stringify({ type: "req", id, method, params }));
    return response;
  }

  close() {
    if (this.ws) {
      this.ws.removeEventListener("message", this.onMessage);
      this.ws.close();
      this.ws = null;
    }
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("OpenClaw Gateway connection closed"));
      this.pending.delete(id);
    }
  }

  private async waitForOpen(timeoutMs: number): Promise<void> {
    if (!this.ws) throw new Error("OpenClaw Gateway WebSocket not created");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`OpenClaw Gateway connection timeout: ${this.options.url}`)), timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.ws?.removeEventListener("open", onOpen);
        this.ws?.removeEventListener("error", onError);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (event: WebSocketEventLike) => {
        cleanup();
        reject(toError(event.error, `OpenClaw Gateway connection failed: ${this.options.url}`));
      };
      this.ws?.addEventListener("open", onOpen);
      this.ws?.addEventListener("error", onError);
    });
  }

  private async waitForChallenge(timeoutMs: number): Promise<string> {
    if (this.challengeNonce) return this.challengeNonce;
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.challengeResolve = null;
        this.challengeReject = null;
        reject(new Error("OpenClaw Gateway connect challenge timeout"));
      }, timeoutMs);
      this.challengeResolve = (nonce) => {
        clearTimeout(timer);
        this.challengeResolve = null;
        this.challengeReject = null;
        resolve(nonce);
      };
      this.challengeReject = (error) => {
        clearTimeout(timer);
        this.challengeResolve = null;
        this.challengeReject = null;
        reject(error);
      };
    });
  }

  private readonly onMessage = (event: WebSocketEventLike) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(messageDataToString(event.data));
    } catch {
      return;
    }
    if (!isRecord(parsed)) return;
    if (parsed.event === "connect.challenge") {
      const payload = isRecord(parsed.payload) ? parsed.payload : {};
      const nonce = readString(payload.nonce);
      if (nonce) {
        this.challengeNonce = nonce;
        this.challengeResolve?.(nonce);
      } else {
        this.challengeReject?.(new Error("OpenClaw Gateway connect challenge missing nonce"));
      }
      return;
    }
    if (parsed.type !== "res" || typeof parsed.id !== "string") return;
    const pending = this.pending.get(parsed.id);
    if (!pending) return;
    const payload = isRecord(parsed.payload) ? parsed.payload : {};
    if (pending.expectFinal && payload.status === "accepted") return;
    this.pending.delete(parsed.id);
    clearTimeout(pending.timer);
    if (parsed.ok === true) pending.resolve(parsed.payload);
    else pending.reject(new Error(formatGatewayError(parsed.error)));
  };
}

function extractGatewayText(value: unknown) {
  const result = isRecord(value) && isRecord(value.result) ? value.result : {};
  const payloads = Array.isArray(result.payloads) ? result.payloads : [];
  const text = payloads
    .map((payload) => isRecord(payload) ? readString(payload.text) : undefined)
    .filter((item): item is string => Boolean(item))
    .join("\n\n")
    .trim();
  if (text) return text;
  if (isRecord(value)) {
    return readString(value.text) ?? readString(value.summary) ?? JSON.stringify(value);
  }
  return String(value ?? "");
}

function formatGatewayError(error: unknown) {
  if (!isRecord(error)) return "OpenClaw Gateway RPC failed";
  const message = readString(error.message) ?? "OpenClaw Gateway RPC failed";
  const code = readString(error.code);
  return code ? `${code}: ${message}` : message;
}

function messageDataToString(data: unknown) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  return String(data ?? "");
}

function toError(value: unknown, fallback: string) {
  return value instanceof Error ? value : new Error(fallback);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
