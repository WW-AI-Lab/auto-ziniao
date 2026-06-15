import { existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

import { readJsonFile, ZiniaoError } from "@ww-ai-lab/auto-ziniao-core";
import type { KnownZclawTool } from "@ww-ai-lab/auto-ziniao-schemas";

export const DEFAULT_ZCLAW_BASE_URL = "http://127.0.0.1:9481";
export const DEFAULT_ZCLAW_CONFIG_PATH = path.join(
  homedir(),
  ".zclaw",
  "config.json"
);

export type ZClawErrorCode =
  | "zclaw_config_missing"
  | "zclaw_path_forbidden"
  | "zclaw_bridge_unavailable"
  | "zclaw_http_error"
  | "zclaw_response_error"
  | "zclaw_tool_error"
  | "zclaw_timeout";

export type ZClawErrorDetails = {
  tool?: string;
  status?: number;
  raw?: unknown;
  cause?: unknown;
};

export class ZClawError extends ZiniaoError {
  readonly tool?: string;
  readonly status?: number;
  readonly raw?: unknown;
  readonly cause?: unknown;

  constructor(
    message: string,
    code: ZClawErrorCode,
    details: ZClawErrorDetails = {}
  ) {
    super(message, code, details);
    this.name = "ZClawError";
    this.tool = details.tool;
    this.status = details.status;
    this.raw = details.raw;
    this.cause = details.cause;
  }
}

export type ZClawConfig = {
  baseUrl: string;
  apiKey: string;
};

export type ZClawConfigInput = {
  env?: NodeJS.ProcessEnv;
  configPath?: string;
  baseUrl?: string;
  apiKey?: string;
  requireApiKey?: boolean;
};

type ZClawConfigFile = {
  ZCLAW_BASE_URL?: unknown;
  ZCLAW_API_KEY?: unknown;
};

export function loadZClawConfig(input: ZClawConfigInput = {}): ZClawConfig {
  const env = input.env ?? process.env;
  const configPath = input.configPath ?? DEFAULT_ZCLAW_CONFIG_PATH;
  const fileConfig = readZClawConfigFile(configPath);

  const baseUrl =
    input.baseUrl ??
    stringValue(env.ZCLAW_BASE_URL) ??
    stringValue(fileConfig.ZCLAW_BASE_URL) ??
    DEFAULT_ZCLAW_BASE_URL;
  const apiKey =
    input.apiKey ??
    stringValue(env.ZCLAW_API_KEY) ??
    stringValue(fileConfig.ZCLAW_API_KEY) ??
    "";

  const normalized = {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey
  };

  if ((input.requireApiKey ?? true) && !normalized.apiKey) {
    throw new ZClawError(
      "API key 未配置。请设置 ZCLAW_API_KEY 环境变量或 ~/.zclaw/config.json",
      "zclaw_config_missing"
    );
  }

  return normalized;
}

function readZClawConfigFile(configPath: string): ZClawConfigFile {
  if (!existsSync(configPath)) {
    return {};
  }
  try {
    return readJsonFile<ZClawConfigFile>(configPath);
  } catch (error) {
    throw new ZClawError("ZClaw 配置文件解析失败", "zclaw_config_missing", {
      cause: error
    });
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export type ZClawClientOptions = ZClawConfigInput & {
  storeId?: string;
  targetId?: string;
  verbose?: boolean;
  fetchImpl?: FetchLike;
};

export type ZClawBridgeEnvelope<T = unknown> = {
  ret?: number;
  msg?: string;
  data?: T;
};

export type ZClawToolInfo = {
  name: string;
  [key: string]: unknown;
};

export type InvokeArgs = Record<string, unknown>;

export class ZClawClient {
  readonly baseUrl: string;
  readonly apiKey: string;
  storeId?: string;
  targetId?: string;
  verbose: boolean;

  private readonly fetchImpl: FetchLike;

  constructor(options: ZClawClientOptions = {}) {
    const config = loadZClawConfig(options);
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.storeId = options.storeId;
    this.targetId = options.targetId;
    this.verbose = options.verbose ?? false;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async request<T = unknown>(
    method: "GET" | "POST",
    requestPath: string,
    body?: unknown,
    timeoutMs = 30000
  ): Promise<ZClawBridgeEnvelope<T>> {
    if (!requestPath.startsWith("/zclaw/")) {
      throw new ZClawError(
        `安全规则禁止访问非 ZClaw 端点: ${requestPath}`,
        "zclaw_path_forbidden"
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const url = `${this.baseUrl}${requestPath}`;

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-ZClaw-Api-Key": this.apiKey
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new ZClawError(
          `ZClaw HTTP 错误: ${response.status} ${response.statusText}`,
          "zclaw_http_error",
          { status: response.status }
        );
      }

      return (await response.json()) as ZClawBridgeEnvelope<T>;
    } catch (error) {
      if (error instanceof ZClawError) {
        throw error;
      }
      if (isAbortError(error)) {
        throw new ZClawError("ZClaw 请求超时", "zclaw_timeout", {
          cause: error
        });
      }
      throw new ZClawError("Bridge 连接失败", "zclaw_bridge_unavailable", {
        cause: error
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async getTools(timeoutMs = 30000): Promise<ZClawToolInfo[]> {
    const result = await this.request<ZClawToolInfo[]>(
      "GET",
      "/zclaw/tools",
      undefined,
      timeoutMs
    );
    if (result.ret === 0 && Array.isArray(result.data)) {
      return result.data;
    }
    throw new ZClawError("获取工具列表失败", "zclaw_response_error", {
      raw: result
    });
  }

  async getToolNames(timeoutMs = 30000): Promise<string[]> {
    return (await this.getTools(timeoutMs)).map((tool) => tool.name);
  }

  async invoke<T = unknown>(
    tool: KnownZclawTool,
    args: InvokeArgs = {},
    timeoutMs = 30000
  ): Promise<T> {
    const finalArgs = { ...args };
    if (this.storeId && finalArgs.storeId === undefined) {
      finalArgs.storeId = this.storeId;
    }
    if (this.targetId && finalArgs.targetId === undefined) {
      finalArgs.targetId = this.targetId;
    }

    const result = await this.request<T>(
      "POST",
      "/zclaw/tools/invoke",
      { tool, args: finalArgs },
      timeoutMs
    );

    if (result.ret !== 0) {
      throw new ZClawError(
        `invoke 返回错误: ${result.msg ?? "unknown"}`,
        "zclaw_response_error",
        { tool, raw: result }
      );
    }
    if (isRecord(result.data) && result.data.ok === false) {
      throw new ZClawError(
        `工具调用失败: ${String(result.data.error ?? "unknown")}`,
        "zclaw_tool_error",
        { tool, raw: result }
      );
    }

    return result.data as T;
  }

  async listStores(): Promise<unknown[]> {
    const data = await this.invoke<{ items?: unknown[] }>("list_stores", {
      all: true
    });
    return Array.isArray(data.items) ? data.items : [];
  }

  async openStore(input: {
    storeId?: string;
    storeName?: string;
    launchUrl?: string;
  } = {}): Promise<Record<string, unknown>> {
    const args: InvokeArgs = {};
    if (input.storeId) {
      args.storeId = input.storeId;
    } else if (input.storeName) {
      args.storeName = input.storeName;
    }
    if (input.launchUrl) {
      args.launchUrl = input.launchUrl;
    }

    const data = await this.invoke<Record<string, unknown>>(
      "open_store",
      args,
      60000
    );
    if (typeof data.storeId === "string") {
      this.storeId = data.storeId;
    }
    return data;
  }

  async closeStore(storeId?: string): Promise<unknown> {
    const sid = storeId ?? this.storeId;
    return this.invoke("close_store", sid ? { storeId: sid } : {});
  }

  async visit(
    url: string,
    options: { waitUntil?: string; timeoutMs?: number } = {}
  ): Promise<unknown> {
    const timeoutMs = options.timeoutMs ?? 30000;
    return this.invoke(
      "visit_page",
      {
        url,
        waitUntil: options.waitUntil ?? "domcontentloaded",
        timeoutMs
      },
      Math.floor(timeoutMs / 1000) * 1000 + 15000
    );
  }

  async executeScript<T = unknown>(
    script: string,
    returnByValue = true
  ): Promise<T | string> {
    const result = await this.invoke<{ data?: { result?: unknown } }>(
      "execute_script",
      {
        script,
        returnByValue
      }
    );
    const inner = result.data?.result;
    if (typeof inner === "string") {
      try {
        return JSON.parse(inner) as T;
      } catch {
        return inner;
      }
    }
    return inner as T;
  }

  async screenshot(
    options: { fullPage?: boolean; format?: "png" | "jpeg" } = {}
  ): Promise<string> {
    const result = await this.invoke<{ data?: { filePath?: unknown } }>(
      "take_screenshot",
      {
        fullPage: options.fullPage ?? false,
        format: options.format ?? "png"
      }
    );
    return typeof result.data?.filePath === "string" ? result.data.filePath : "";
  }

  async click(
    input: {
      selector?: string;
      hint?: string;
      waitForNavigation?: boolean;
      timeoutMs?: number;
    } = {}
  ): Promise<unknown> {
    const timeoutMs = input.timeoutMs ?? 10000;
    const args: InvokeArgs = { timeoutMs };
    if (input.selector) {
      args.selector = input.selector;
    }
    if (input.hint) {
      args.hint = input.hint;
    }
    if (input.waitForNavigation) {
      args.waitForNavigation = true;
    }
    return this.invoke(
      "click_element",
      args,
      Math.floor(timeoutMs / 1000) * 1000 + 10000
    );
  }

  async waitElement(
    selector: string,
    options: { timeoutMs?: number; state?: string } = {}
  ): Promise<unknown> {
    const timeoutMs = options.timeoutMs ?? 10000;
    return this.invoke(
      "wait_for_element",
      {
        selector,
        timeoutMs,
        state: options.state ?? "visible"
      },
      Math.floor(timeoutMs / 1000) * 1000 + 5000
    );
  }
}

export function createZClawClient(options: ZClawClientOptions = {}): ZClawClient {
  return new ZClawClient(options);
}

function isAbortError(error: unknown): boolean {
  return (
    isRecord(error) &&
    (error.name === "AbortError" ||
      error.code === "ABORT_ERR" ||
      String(error.message ?? "").includes("aborted"))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
