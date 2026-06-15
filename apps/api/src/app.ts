import { createReadStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import Fastify, { FastifyInstance, FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";

import { ensureDir, readJsonFile, readJsonLinesFile, writeJsonFile } from "@ww-ai-lab/auto-ziniao-core";
import { validateFlow } from "@ww-ai-lab/auto-ziniao-flow-engine";
import { AgentRunner } from "@ww-ai-lab/auto-ziniao-self-heal";

import { defaultChatCommandRunner, sendChatWithAgent, type ChatCommandRunner } from "./chat-adapters.js";
import { createConfig, getHealConfig, getWebAdminChatConfig, WebAdminConfig, type CommandLocator } from "./config.js";
import { badRequest, conflict, notFound, ApiError } from "./errors.js";
import { GatewayChatClient, OpenClawGatewayRpcChatClient } from "./openclaw-gateway.js";
import { createFlowRunner } from "./runner.js";
import { createScheduler } from "./scheduler.js";
import { resolveSafePath, isDirectory, isFile, AllowedRoot } from "./security.js";
import { createStorage, Storage } from "./storage.js";
import { computeNextRun, validateTrigger, TriggerError } from "./triggers.js";
import type { ChatA2UIBlock, ChatExtras, ChatToolCall, CreateFlowRequest, SaveExtractRequest } from "@ww-ai-lab/auto-ziniao-schemas";

export type CreateAppOptions = {
  config?: Partial<WebAdminConfig>;
  storage?: Storage;
  runner?: ReturnType<typeof createFlowRunner>;
  agentRunner?: AgentRunner;
  chatClient?: GatewayChatClient;
  chatCommandRunner?: ChatCommandRunner;
  commandLocator?: CommandLocator;
  startScheduler?: boolean;
};

export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const config = createConfig(options.config);
  const storage = options.storage ?? createStorage(path.join(config.dataRoot, "webadmin.db"));
  const agentRunner = options.agentRunner ?? createCommandAgentRunner();
  const chatClient = options.chatClient ?? new OpenClawGatewayRpcChatClient();
  const runner =
    options.runner ??
    createFlowRunner({
      repoRoot: config.repoRoot,
      dataRoot: config.dataRoot,
      storage,
      agentRunner,
      timeoutMs: config.flowTimeoutMs
    });
  const scheduler = createScheduler({ storage, runner });
  const app = Fastify({ logger: false });
  const roots = allowedRoots(config);
  const busySessions = new Set<string>();

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details }
      });
      return;
    }
    const err = error as Error & { statusCode?: number };
    const statusCode = typeof err.statusCode === "number" ? err.statusCode : 500;
    reply.status(statusCode).send({
      error: {
        code: statusCode === 404 ? "not_found" : statusCode === 400 ? "bad_request" : "internal_error",
        message: err.message || "内部错误"
      }
    });
  });

  app.addHook("onClose", async () => {
    storage.close();
  });

  if (options.startScheduler) {
    scheduler.recomputeAll();
  }

  registerFlowRoutes(app, { config, roots, runner, storage });
  registerMonitoringRoutes(app, { config, roots, storage });
  registerScheduleRoutes(app, { config, storage, scheduler });
  registerChatRoutes(app, {
    config,
    storage,
    busySessions,
    chatClient,
    chatCommandRunner: options.chatCommandRunner ?? defaultChatCommandRunner,
    commandLocator: options.commandLocator
  });
  await registerStaticRoutes(app, config);
  return app;
}

export async function startServer(options: CreateAppOptions = {}) {
  const config = createConfig(options.config);
  const app = await createApp({ ...options, config, startScheduler: true });
  await app.listen({ host: config.host, port: config.port });
  return app;
}

function registerFlowRoutes(
  app: FastifyInstance,
  deps: { config: WebAdminConfig; roots: Record<AllowedRoot, string>; runner: ReturnType<typeof createFlowRunner>; storage: Storage }
) {
  app.get("/api/flows", async () => ({ items: await listFlows(deps.config, deps.runner) }));

  app.get("/api/flows/template", async () => ({ content: flowTemplateContent("__FLOW_ID__", "__FLOW_NAME__") }));

  app.post<{ Body: CreateFlowRequest }>("/api/flows", async (request) => {
    const body = request.body ?? {};
    const flowId = validateFlowId(body.id);
    const file = flowFile(deps.config.repoRoot, flowId);
    if (existsSync(file)) throw conflict(`流程已存在: ${flowId}`);
    const content = body.content ?? flowTemplateContent(flowId, body.name?.trim() || flowId);
    const parsed = validateFlowContent(deps.config.repoRoot, flowId, content);
    ensureDir(path.dirname(file));
    writeJsonFile(file, parsed);
    return {
      id: flowId,
      name: String(parsed.name ?? flowId),
      content: `${JSON.stringify(parsed, null, 2)}\n`,
      created: true,
      warnings: []
    };
  });

  app.get<{ Params: { flowId: string } }>("/api/flows/:flowId", async (request) => {
    const flowId = request.params.flowId;
    const file = flowFile(deps.config.repoRoot, flowId);
    if (!existsSync(file)) throw notFound(`流程不存在: ${flowId}`);
    const content = readFileSync(file, "utf8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return {
      id: flowId,
      content,
      extracts: findExtractRefs(deps.config.repoRoot, parsed),
      last_run: await lastRunOf(deps.config.dataRoot, flowId),
      running: deps.runner.isRunning(flowId)
    };
  });

  app.get<{ Params: { flowId: string }; Querystring: RunQuery }>("/api/flows/:flowId/runs", async (request) => {
    validateFlowId(request.params.flowId);
    return flowRunHistory(deps, { ...request.query, flow_id: request.params.flowId });
  });

  app.post<{ Params: { flowId: string }; Body: { content?: string } }>("/api/flows/:flowId/validate", async (request) => {
    validateFlowContent(deps.config.repoRoot, request.params.flowId, request.body?.content);
    return { valid: true, warnings: [] };
  });

  app.put<{ Params: { flowId: string }; Body: { content?: string } }>("/api/flows/:flowId", async (request) => {
    const parsed = validateFlowContent(deps.config.repoRoot, request.params.flowId, request.body?.content);
    const file = flowFile(deps.config.repoRoot, request.params.flowId);
    backupFlow(deps.config.repoRoot, request.params.flowId);
    writeJsonFile(file, parsed);
    return { saved: true, warnings: [] };
  });

  app.post<{ Params: { flowId: string }; Body: { params?: Record<string, string> } }>("/api/flows/:flowId/run", async (request) => {
    if (!existsSync(flowFile(deps.config.repoRoot, request.params.flowId))) {
      throw notFound(`流程不存在: ${request.params.flowId}`);
    }
    try {
      return deps.runner.start(request.params.flowId, request.body?.params ?? {});
    } catch (error) {
      throw conflict(error instanceof Error ? error.message : String(error));
    }
  });

  app.get<{ Params: { token: string } }>("/api/flow-runs/:token", async (request) => {
    const entry = deps.runner.get(request.params.token);
    if (entry) return entry;
    const persisted = deps.storage.getFlowRunByToken(request.params.token);
    if (!persisted) throw notFound(`运行记录不存在: ${request.params.token}`);
    return toRunHistoryItem(persisted);
  });

  app.get<{ Params: { "*": string } }>("/api/extracts/*", async (request) => {
    const name = extractNameFromParams(request.params);
    const file = resolveExtractFile(deps.roots, name);
    const exists = isFile(file);
    return {
      name,
      path: `extracts/${name}`,
      exists,
      content: exists ? readFileSync(file, "utf8") : null
    };
  });

  app.put<{ Params: { "*": string }; Body: SaveExtractRequest }>("/api/extracts/*", async (request) => {
    const name = extractNameFromParams(request.params);
    const content = request.body?.content;
    if (typeof content !== "string") throw badRequest("content 不能为空");
    const file = resolveExtractFile(deps.roots, name);
    ensureDir(path.dirname(file));
    writeFileSync(file, content, "utf8");
    return {
      name,
      path: `extracts/${name}`,
      exists: true,
      content
    };
  });
}

function registerMonitoringRoutes(
  app: FastifyInstance,
  deps: { config: WebAdminConfig; roots: Record<AllowedRoot, string>; storage: Storage }
) {
  app.get<{ Querystring: RunQuery }>("/api/runs", async (request) => {
    return flowRunHistory(deps, request.query);
  });

  app.get<{ Params: { runId: string } }>("/api/runs/:runId", async (request) => {
    const detail = await flowRunDetail(deps, request.params.runId);
    if (!detail) throw notFound(`运行记录不存在: ${request.params.runId}`);
    return detail;
  });

  app.get<{ Querystring: { limit?: string; offset?: string } }>("/api/heals", async (request) => {
    const entries = await readJsonlSafe<Record<string, unknown>>(path.join(deps.config.repoRoot, "learnings", "heals.jsonl"));
    const offset = Number(request.query.offset ?? 0);
    return { total: entries.length, items: entries.reverse().slice(offset, offset + Number(request.query.limit ?? 50)) };
  });

  app.get<{ Params: { healId: string } }>("/api/heals/:healId", async (request) => {
    const healId = request.params.healId;
    if (!/^[A-Za-z0-9_-]+$/.test(healId)) throw notFound(`自愈记录不存在: ${healId}`);
    const contextFile = path.join(deps.config.dataRoot, "logs", "heals", `${healId}.json`);
    if (!existsSync(contextFile)) throw notFound(`自愈记录不存在: ${healId}`);
    const promptA = path.join(deps.config.dataRoot, "logs", "heals", `${healId}_prompt.md`);
    const promptB = path.join(deps.config.dataRoot, "logs", "heals", `${healId}.md`);
    return {
      heal_id: healId,
      context: readJsonFile(contextFile),
      prompt: existsSync(promptA) ? readFileSync(promptA, "utf8") : existsSync(promptB) ? readFileSync(promptB, "utf8") : null
    };
  });

  app.get("/api/known-issues", async () => {
    const file = path.join(deps.config.repoRoot, "learnings", "known_issues.json");
    if (!existsSync(file)) return { items: [] };
    const parsed = readJsonFile<unknown>(file);
    return { items: Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.issues) ? parsed.issues : [] };
  });

  app.get("/api/stats", async () => {
    const entries = (await readJsonlSafe<Record<string, unknown>>(path.join(deps.config.dataRoot, "logs", "runs.jsonl"))).slice(-1000);
    const heals = await readJsonlSafe<Record<string, unknown>>(path.join(deps.config.repoRoot, "learnings", "heals.jsonl"));
    const healsByFlow = new Map<string, number>();
    for (const heal of heals) {
      const flowId = typeof heal.flow_id === "string" ? heal.flow_id : null;
      if (flowId) healsByFlow.set(flowId, (healsByFlow.get(flowId) ?? 0) + 1);
    }
    const flows = new Map<string, { total: number; success: number; last_run?: string | null; last_status?: string | null }>();
    for (const entry of entries) {
      const flowId = String(entry.flow_id ?? "unknown");
      const stat = flows.get(flowId) ?? { total: 0, success: 0 };
      stat.total += 1;
      if (entry.status === "success") stat.success += 1;
      stat.last_run = typeof entry.timestamp === "string" ? entry.timestamp : null;
      stat.last_status = typeof entry.status === "string" ? entry.status : null;
      flows.set(flowId, stat);
    }
    const schedules = deps.storage.listSchedules();
    return {
      runs_total: entries.length,
      runs_success: entries.filter((entry) => entry.status === "success").length,
      runs_failed: entries.filter((entry) => entry.status === "failed").length,
      runs_error: entries.filter((entry) => entry.status === "error").length,
      heals_total: heals.length,
      schedules: {
        total: schedules.length,
        enabled: schedules.filter((schedule) => schedule.enabled).length
      },
      flows: [...flows.entries()].map(([flow_id, stat]) => ({
        flow_id,
        ...stat,
        success_rate: stat.total ? Math.round((stat.success / stat.total) * 100) : 0,
        heal_count: healsByFlow.get(flow_id) ?? 0
      })),
      chat_sessions: deps.storage.listSessions().length
    };
  });

  app.get<{ Querystring: { path?: string } }>("/api/outputs", async (request) => {
    const target = resolveSafePath(deps.roots, "output", request.query.path ?? "");
    if (!existsSync(target)) return { path: request.query.path ?? "", dirs: [], files: [] };
    if (!isDirectory(target)) throw badRequest(`不是目录: ${request.query.path ?? ""}`);
    const dirs = [];
    const files = [];
    for (const name of readdirSync(target).sort()) {
      if (name.startsWith(".")) continue;
      const child = path.join(target, name);
      const stat = statSync(child);
      if (stat.isDirectory()) dirs.push({ name, type: "dir" });
      else files.push({ name, type: "file", size: stat.size, mtime: stat.mtimeMs });
    }
    return { path: request.query.path ?? "", dirs, files };
  });

  app.get<{ Querystring: { path?: string } }>("/api/outputs/preview", async (request) => {
    const target = resolveSafePath(deps.roots, "output", request.query.path ?? "");
    if (!isFile(target)) throw notFound(`文件不存在: ${request.query.path ?? ""}`);
    const size = statSync(target).size;
    if (size > 2 * 1024 * 1024) return { too_large: true, size };
    try {
      return { too_large: false, binary: false, size, name: path.basename(target), content: readFileSync(target, "utf8") };
    } catch {
      return { binary: true, size };
    }
  });

  app.get<{ Querystring: { path?: string } }>("/api/outputs/download", async (request, reply) => {
    const target = resolveSafePath(deps.roots, "output", request.query.path ?? "");
    if (!isFile(target)) throw notFound(`文件不存在: ${request.query.path ?? ""}`);
    reply.header("content-disposition", `attachment; filename="${path.basename(target)}"`);
    return reply.send(createReadStream(target));
  });

  // 轨迹推送：skill 通过此 API 写入 traces，避免在 skill 文件中硬编码文件系统路径
  app.post<{ Body: { ts?: string; tool?: string; args?: Record<string, unknown>; ok?: boolean; note?: string } }>("/api/traces", async (request) => {
    const body = request.body ?? {};
    // ── 合规校验 ──
    if (!body.tool || typeof body.tool !== "string" || !/^[A-Za-z0-9_-]+$/.test(body.tool)) {
      throw badRequest("tool 字段必须是非空字母数字字符串");
    }
    if (typeof body.ok !== "boolean") {
      throw badRequest("ok 字段必须是布尔值");
    }
    const ts = body.ts ?? new Date().toISOString();
    if (typeof ts !== "string" || Number.isNaN(Date.parse(ts))) {
      throw badRequest("ts 字段必须是合法的 ISO 时间字符串");
    }
    // ── 从 ts 提取日期作为文件名，防止路径穿越 ──
    const datePart = ts.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      throw badRequest("ts 字段格式异常，无法提取日期");
    }
    const tracesDir = path.join(deps.config.dataRoot, "logs", "traces");
    ensureDir(tracesDir);
    const entry = {
      ts,
      tool: body.tool,
      args: body.args ?? {},
      ok: body.ok,
      ...(body.note ? { note: body.note } : {})
    };
    const file = path.join(tracesDir, `${datePart}.jsonl`);
    writeFileSync(file, `${JSON.stringify(entry)}\n`, { flag: "a" });
    return { written: true, file: `traces/${datePart}.jsonl` };
  });

  // 轨迹查询：按日期列出 traces
  app.get<{ Querystring: { date?: string } }>("/api/traces", async (request) => {
    const tracesDir = path.join(deps.config.dataRoot, "logs", "traces");
    if (!existsSync(tracesDir)) return { items: [] };
    const date = request.query.date;
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest("date 参数格式必须为 YYYY-MM-DD");
      const file = path.join(tracesDir, `${date}.jsonl`);
      if (!existsSync(file)) return { date, items: [] };
      return { date, items: await readJsonlSafe<Record<string, unknown>>(file) };
    }
    const files = readdirSync(tracesDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .reverse();
    return {
      dates: files.map((f) => f.replace(".jsonl", "")),
      items: files.length > 0 ? await readJsonlSafe<Record<string, unknown>>(path.join(tracesDir, files[0]!)) : []
    };
  });
}

function registerScheduleRoutes(
  app: FastifyInstance,
  deps: { config: WebAdminConfig; storage: Storage; scheduler: ReturnType<typeof createScheduler> }
) {
  app.get("/api/schedules", async () => ({
    items: deps.storage.listSchedules().map((item) => ({ ...item, latest_run: deps.storage.latestScheduleRun(String(item.id)) }))
  }));

  app.post<{ Body: { name?: string; flow_id?: string; params?: Record<string, string>; trigger?: Record<string, unknown>; enabled?: boolean } }>("/api/schedules", async (request) => {
    const body = request.body ?? {};
    if (!body.name?.trim()) throw badRequest("任务名称不能为空");
    if (!body.flow_id) throw badRequest("flow_id 不能为空");
    if (!existsSync(flowFile(deps.config.repoRoot, body.flow_id))) throw badRequest(`flow 不存在: ${body.flow_id}`);
    if (!body.trigger) throw badRequest("trigger 不能为空");
    try {
      validateTrigger(body.trigger);
    } catch (error) {
      throw badRequest(`触发配置非法: ${error instanceof Error ? error.message : String(error)}`);
    }
    return deps.storage.createSchedule({
      name: body.name.trim(),
      flow_id: body.flow_id,
      params: body.params ?? {},
      trigger: body.trigger,
      enabled: body.enabled !== false,
      next_run_at: computeNextRun(body.trigger).toISOString()
    });
  });

  app.get<{ Params: { sid: string } }>("/api/schedules/:sid", async (request) => {
    const schedule = deps.storage.getSchedule(request.params.sid);
    if (!schedule) throw notFound(`任务不存在: ${request.params.sid}`);
    return { ...schedule, latest_run: deps.storage.latestScheduleRun(request.params.sid) };
  });

  app.put<{ Params: { sid: string }; Body: Record<string, unknown> }>("/api/schedules/:sid", async (request) => {
    const current = deps.storage.getSchedule(request.params.sid);
    if (!current) throw notFound(`任务不存在: ${request.params.sid}`);
    const fields = { ...request.body };
    if (typeof fields.flow_id === "string" && !existsSync(flowFile(deps.config.repoRoot, fields.flow_id))) {
      throw badRequest(`flow 不存在: ${fields.flow_id}`);
    }
    if (fields.trigger) {
      try {
        validateTrigger(fields.trigger as Record<string, unknown>);
        fields.next_run_at = computeNextRun(fields.trigger as Record<string, unknown>).toISOString();
      } catch (error) {
        throw badRequest(`触发配置非法: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (fields.enabled === true) {
      fields.next_run_at = computeNextRun(current.trigger as Record<string, unknown>).toISOString();
    }
    const updated = deps.storage.updateSchedule(request.params.sid, fields);
    return { ...updated, latest_run: deps.storage.latestScheduleRun(request.params.sid) };
  });

  app.delete<{ Params: { sid: string } }>("/api/schedules/:sid", async (request) => {
    if (!deps.storage.deleteSchedule(request.params.sid)) throw notFound(`任务不存在: ${request.params.sid}`);
    return { deleted: true };
  });

  app.get<{ Params: { sid: string }; Querystring: { limit?: string; offset?: string } }>("/api/schedules/:sid/runs", async (request) => {
    if (!deps.storage.getSchedule(request.params.sid)) throw notFound(`任务不存在: ${request.params.sid}`);
    const rows = deps.storage.listScheduleRuns(request.params.sid, Number(request.query.limit ?? 20), Number(request.query.offset ?? 0));
    return {
      items: rows.map((row) => {
        const runId = typeof row.run_id === "string" ? row.run_id : null;
        const run = runId ? deps.storage.getFlowRun(runId) : null;
        return {
          ...row,
          run_id: runId,
          flow_status: run?.status ?? row.status,
          heal_summary: run?.heal_summary ?? null
        };
      })
    };
  });
}

function registerChatRoutes(
  app: FastifyInstance,
  deps: {
    config: WebAdminConfig;
    storage: Storage;
    busySessions: Set<string>;
    chatClient: GatewayChatClient;
    chatCommandRunner: ChatCommandRunner;
    commandLocator?: CommandLocator;
  }
) {
  const preferenceKey = "chat.default_agent";
  const effectiveDefaultAgent = () => {
    const cfg = getWebAdminChatConfig(deps.config.repoRoot, { commandLocator: deps.commandLocator });
    const preferred = deps.storage.getMeta(preferenceKey);
    if (preferred && cfg.agents[preferred]?.available) return { cfg, defaultAgent: preferred };
    return { cfg, defaultAgent: cfg.defaultAgent };
  };

  app.get("/api/chat/agents", async () => {
    const { cfg, defaultAgent } = effectiveDefaultAgent();
    return {
      default: defaultAgent,
      items: Object.values(cfg.agents).map((agent) => ({
        name: agent.name,
        type: agent.type,
        label: agent.label,
        type_label: agent.typeLabel,
        description: agent.description,
        icon: agent.icon,
        timeout_sec: agent.timeoutSec,
        available: agent.available,
        source: agent.source,
        diagnostic: agent.diagnostic,
        capabilities: agent.capabilities
      }))
    };
  });

  app.get("/api/chat/preferences", async () => {
    const { defaultAgent } = effectiveDefaultAgent();
    return { default_agent: defaultAgent };
  });

  app.put<{ Body: { default_agent?: string } }>("/api/chat/preferences", async (request) => {
    const agentName = request.body?.default_agent;
    if (!agentName) throw badRequest("default_agent 不能为空");
    const cfg = getWebAdminChatConfig(deps.config.repoRoot, { commandLocator: deps.commandLocator });
    const agent = cfg.agents[agentName];
    if (!agent) throw badRequest(`未发现 agent: ${agentName}`);
    if (!agent.available) throw badRequest(`agent 不可用: ${agentName}`);
    deps.storage.setMeta(preferenceKey, agentName);
    return { default_agent: agentName };
  });

  app.get("/api/chat/sessions", async () => ({
    items: deps.storage.listSessions().map((session) => ({ ...session, busy: deps.busySessions.has(String(session.id)) }))
  }));

  app.post<{ Body: { title?: string; agent?: string } }>("/api/chat/sessions", async (request) => {
    const { cfg, defaultAgent } = effectiveDefaultAgent();
    const agent = request.body?.agent ?? defaultAgent;
    if (!cfg.agents[agent]) throw badRequest(`未发现 agent: ${agent}`);
    if (!cfg.agents[agent].available) throw badRequest(`agent 不可用: ${agent}`);
    return deps.storage.createSession(request.body?.title?.trim() || "新会话", agent);
  });

  app.put<{ Params: { sid: string }; Body: { title?: string; agent?: string; remember_default?: boolean } }>("/api/chat/sessions/:sid", async (request) => {
    if (!deps.storage.getSession(request.params.sid)) throw notFound(`会话不存在: ${request.params.sid}`);
    if (request.body.agent) {
      const agent = getWebAdminChatConfig(deps.config.repoRoot, { commandLocator: deps.commandLocator }).agents[request.body.agent];
      if (!agent) throw badRequest(`未发现 agent: ${request.body.agent}`);
      if (!agent.available) throw badRequest(`agent 不可用: ${request.body.agent}`);
      if (request.body.remember_default) {
        deps.storage.setMeta(preferenceKey, request.body.agent);
      }
    }
    return deps.storage.updateSession(request.params.sid, { title: request.body.title, agent: request.body.agent });
  });

  app.delete<{ Params: { sid: string } }>("/api/chat/sessions/:sid", async (request) => {
    if (deps.busySessions.has(request.params.sid)) throw conflict("会话有进行中的消息，无法删除");
    if (!deps.storage.deleteSession(request.params.sid)) throw notFound(`会话不存在: ${request.params.sid}`);
    return { deleted: true };
  });

  app.get<{ Params: { sid: string } }>("/api/chat/sessions/:sid/messages", async (request) => {
    if (!deps.storage.getSession(request.params.sid)) throw notFound(`会话不存在: ${request.params.sid}`);
    return { items: deps.storage.listMessages(request.params.sid), busy: deps.busySessions.has(request.params.sid) };
  });

  app.post<{ Params: { sid: string }; Body: { content?: string } }>("/api/chat/sessions/:sid/messages", async (request, reply) => {
    const session = deps.storage.getSession(request.params.sid);
    if (!session) throw notFound(`会话不存在: ${request.params.sid}`);
    const content = request.body?.content ?? "";
    if (!content.trim()) throw badRequest("消息内容不能为空");
    if (deps.busySessions.has(request.params.sid)) throw conflict("当前会话有进行中的消息，请等待完成");
    deps.busySessions.add(request.params.sid);
    deps.storage.addMessage({ session_id: request.params.sid, role: "user", content, status: "done" });
    const assistantId = deps.storage.addMessage({ session_id: request.params.sid, role: "assistant", content: "", status: "pending" });
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache"
    });
    writeSse(reply, { type: "accepted", session_id: request.params.sid, message_id: assistantId });
    writeSse(reply, { type: "start", session_id: request.params.sid, message_id: assistantId });
    try {
      const cfg = getWebAdminChatConfig(deps.config.repoRoot, { commandLocator: deps.commandLocator });
      const agentName = String(session.agent);
      const agent = cfg.agents[agentName];
      if (!agent) throw badRequest(`未发现 agent: ${agentName}`);
      const result = await sendChatWithAgent({
        agentName,
        agent,
        sessionId: request.params.sid,
        content,
        messageId: assistantId,
        repoRoot: deps.config.repoRoot,
        gatewayClient: deps.chatClient,
        commandRunner: deps.chatCommandRunner
      });
      const text = result.text || "OK";
      const extras = buildChatExtras(result);
      writeChatExtrasSse(reply, request.params.sid, assistantId, extras);
      writeSse(reply, { type: "delta", session_id: request.params.sid, message_id: assistantId, text });
      deps.storage.updateMessage(assistantId, { content: text, status: "done", extras });
      writeSse(reply, { type: "done", session_id: request.params.sid, message_id: assistantId, content: text });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const extras = buildChatExtras(error);
      writeChatExtrasSse(reply, request.params.sid, assistantId, extras);
      deps.storage.updateMessage(assistantId, { status: "failed", error: message, extras });
      writeSse(reply, { type: "error", session_id: request.params.sid, message_id: assistantId, message });
    } finally {
      deps.busySessions.delete(request.params.sid);
      reply.raw.end();
    }
  });
}

function buildChatExtras(source: unknown): ChatExtras | undefined {
  if (!source || typeof source !== "object") return undefined;
  const record = source as {
    reasoning?: unknown;
    tools?: unknown;
    a2ui?: unknown;
    agent?: unknown;
    agentLabel?: unknown;
    agentType?: unknown;
    diagnostic?: unknown;
  };
  const extras: ChatExtras = {};
  if (typeof record.agent === "string" && record.agent) {
    extras.agent = record.agent;
  }
  if (typeof record.agentLabel === "string" && record.agentLabel) {
    extras.agent_label = record.agentLabel;
  }
  if (typeof record.agentType === "string" && record.agentType) {
    extras.agent_type = record.agentType;
  }
  if (isRecord(record.diagnostic)) {
    extras.diagnostic = record.diagnostic;
  }
  if (typeof record.reasoning === "string" && record.reasoning) {
    extras.reasoning = record.reasoning;
  }
  if (Array.isArray(record.tools)) {
    const tools = record.tools.filter(isChatToolCall);
    if (tools.length) extras.tools = tools;
  }
  if (Array.isArray(record.a2ui)) {
    const a2ui = record.a2ui.filter(isChatA2UIBlock);
    if (a2ui.length) extras.a2ui = a2ui;
  }
  return extras.reasoning || extras.tools?.length || extras.a2ui?.length || extras.agent || extras.diagnostic ? extras : undefined;
}

function writeChatExtrasSse(reply: FastifyReply, sessionId: string, messageId: number, extras: ChatExtras | undefined) {
  if (!extras) return;
  if (extras.reasoning) {
    writeSse(reply, { type: "reasoning_delta", session_id: sessionId, message_id: messageId, text: extras.reasoning });
  }
  for (const tool of extras.tools ?? []) {
    writeSse(reply, { type: "tool_call", session_id: sessionId, message_id: messageId, ...tool });
  }
  for (const block of extras.a2ui ?? []) {
    writeSse(reply, { type: "a2ui", session_id: sessionId, message_id: messageId, block });
  }
}

function isChatToolCall(value: unknown): value is ChatToolCall {
  return !!value && typeof value === "object" && typeof (value as { name?: unknown }).name === "string";
}

function isChatA2UIBlock(value: unknown): value is ChatA2UIBlock {
  return !!value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string";
}

async function registerStaticRoutes(app: FastifyInstance, config: WebAdminConfig) {
  const dist = config.frontendDist;
  if (existsSync(path.join(dist, "index.html"))) {
    await app.register(fastifyStatic, {
      root: dist,
      prefix: "/",
      wildcard: false
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        reply.status(404).send({ error: { code: "not_found", message: `API 不存在: ${request.url}` } });
      } else {
        reply.type("text/html").send(readFileSync(path.join(dist, "index.html"), "utf8"));
      }
    });
  } else {
    app.get("/", async () => ({
      message: "前端构建产物缺失（apps/web/dist）。API 正常可用，前缀 /api。"
    }));
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        reply.status(404).send({ error: { code: "not_found", message: `API 不存在: ${request.url}` } });
      } else {
        reply.status(200).send({
          message: "前端构建产物缺失（apps/web/dist）。API 正常可用，前缀 /api。"
        });
      }
    });
  }
}

type RunQuery = {
  flow_id?: string;
  schedule_id?: string;
  source?: string;
  status?: string;
  limit?: string;
  offset?: string;
};

async function flowRunHistory(
  deps: { config: WebAdminConfig; roots: Record<AllowedRoot, string>; storage: Storage },
  query: RunQuery
) {
  const limit = clampQueryInt(query.limit, 50, 1, 200);
  const offset = clampQueryInt(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const filters = {
    flow_id: query.flow_id,
    schedule_id: query.schedule_id,
    source: query.source,
    status: query.status,
    limit,
    offset
  };
  const indexed = deps.storage.listFlowRuns(filters).map(toRunHistoryItem);
  const indexedTotal = deps.storage.countFlowRuns(filters);
  const includeHistory = !query.schedule_id && (!query.source || query.source === "history");
  if (!includeHistory) {
    return { total: indexedTotal, limit, offset, items: indexed };
  }
  const historical = await historicalRunItems(deps.config.dataRoot, query.flow_id, query.status);
  const combined = [...indexed, ...historical]
    .sort((a, b) => runSortKey(b).localeCompare(runSortKey(a)));
  return {
    total: indexedTotal + historical.length,
    limit,
    offset,
    items: combined.slice(offset, offset + limit)
  };
}

async function flowRunDetail(
  deps: { config: WebAdminConfig; roots: Record<AllowedRoot, string>; storage: Storage },
  runId: string
) {
  const indexed = deps.storage.getFlowRun(runId);
  if (indexed) {
    const item = toRunHistoryItem(indexed);
    const healId = healIdFrom(item.heal_summary) ?? healIdFrom(indexed.heal_result);
    const healEvents = await matchingHealEvents(deps.config.repoRoot, {
      healId,
      flowId: indexed.flow_id
    });
    const healSummary = mergeHealDiagnostics(item.heal_summary, healEvents);
    const healFiles: Partial<HealFileStatus> = healId ? healFileStatus(deps.config.dataRoot, healId) : {};
    return {
      ...item,
      result: indexed.result,
      heal_result: indexed.heal_result,
      heal_events: healEvents,
      heal_context: healFiles.context_available && healFiles.context_file ? readJsonFile(healFiles.context_file) : null,
      heal_prompt: healFiles.prompt_path
        ? { path: healFiles.prompt_path, available: Boolean(healFiles.prompt_available) }
        : null,
      heal_summary: {
        ...(isRecord(healSummary) ? healSummary : {}),
        ...(healFiles.context_available !== undefined ? { context_available: healFiles.context_available } : {}),
        ...(healFiles.prompt_available !== undefined ? { prompt_available: healFiles.prompt_available } : {})
      },
      output_refs: outputRefsWithAvailability(deps.roots, item.output_refs),
      log_entry: await latestLogEntry(deps.config.dataRoot, indexed.flow_id)
    };
  }
  if (runId.startsWith("history_")) {
    const historical = (await historicalRunItems(deps.config.dataRoot)).find((item) => item.run_id === runId);
    return historical ? { ...historical, heal_events: [], heal_context: null, heal_prompt: null, log_entry: historical } : null;
  }
  return null;
}

function toRunHistoryItem(run: ReturnType<Storage["getFlowRun"]>) {
  if (!run) throw new Error("run is required");
  return {
    run_id: run.run_id,
    token: run.token ?? undefined,
    source: run.source,
    flow_id: run.flow_id,
    schedule_id: run.schedule_id ?? null,
    schedule_run_id: run.schedule_run_id ?? null,
    params: run.params ?? {},
    status: run.status,
    started_at: run.started_at,
    finished_at: run.finished_at ?? null,
    duration_ms: run.duration_ms ?? null,
    exit_code: run.exit_code ?? null,
    error: run.error ?? null,
    failed_step: run.failed_step ?? null,
    data_summary: run.data_summary ?? {},
    output_refs: run.output_refs ?? [],
    heal_summary: run.heal_summary ?? null,
    detail_available: true
  };
}

function runSortKey(item: { started_at?: string | null; timestamp?: string | null }) {
  return String(item.started_at ?? item.timestamp ?? "");
}

async function historicalRunItems(dataRoot: string, flowId?: string, status?: string) {
  const entries = await readJsonlSafe<Record<string, unknown>>(path.join(dataRoot, "logs", "runs.jsonl"));
  return entries
    .filter((entry) => !flowId || entry.flow_id === flowId)
    .filter((entry) => !status || entry.status === status)
    .map((entry, idx) => {
      const idBase = `${entry.flow_id ?? "unknown"}_${entry.timestamp ?? idx}`;
      return {
        run_id: `history_${String(idBase).replace(/[^A-Za-z0-9_-]/g, "_")}`,
        source: "history",
        flow_id: String(entry.flow_id ?? "unknown"),
        params: isRecord(entry.params) ? entry.params : {},
        status: String(entry.status ?? "unknown"),
        started_at: typeof entry.timestamp === "string" ? entry.timestamp : undefined,
        timestamp: typeof entry.timestamp === "string" ? entry.timestamp : undefined,
        duration_ms: typeof entry.duration_ms === "number" ? entry.duration_ms : null,
        error: typeof entry.error === "string" ? entry.error : null,
        failed_step: null,
        data_summary: isRecord(entry.data_summary) ? entry.data_summary : {},
        output_refs: [],
        heal_summary: null,
        detail_available: false
      };
    });
}

async function latestLogEntry(dataRoot: string, flowId: string) {
  const entries = await readJsonlSafe<Record<string, unknown>>(path.join(dataRoot, "logs", "runs.jsonl"));
  return [...entries].reverse().find((entry) => entry.flow_id === flowId) ?? null;
}

async function matchingHealEvents(repoRoot: string, input: { healId?: string | null; flowId?: string }) {
  const entries = await readJsonlSafe<Record<string, unknown>>(path.join(repoRoot, "learnings", "heals.jsonl"));
  return entries.filter((entry) =>
    (input.healId && entry.heal_id === input.healId) || (!input.healId && input.flowId && entry.flow_id === input.flowId)
  );
}

type HealFileStatus = {
  context_file?: string;
  context_available: boolean;
  prompt_path?: string;
  prompt_available: boolean;
};

function healFileStatus(dataRoot: string, healId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(healId)) {
    return { context_available: false, prompt_available: false };
  }
  const contextFile = path.join(dataRoot, "logs", "heals", `${healId}.json`);
  const promptA = path.join(dataRoot, "logs", "heals", `${healId}_prompt.md`);
  const promptB = path.join(dataRoot, "logs", "heals", `${healId}.md`);
  const prompt = existsSync(promptA) ? promptA : existsSync(promptB) ? promptB : null;
  return {
    context_file: contextFile,
    context_available: existsSync(contextFile),
    prompt_path: prompt ?? undefined,
    prompt_available: Boolean(prompt)
  };
}

function outputRefsWithAvailability(roots: Record<AllowedRoot, string>, refs: unknown[]) {
  return refs.map((ref) => {
    if (!isRecord(ref)) return ref;
    const rawPath = typeof ref.path === "string" ? ref.path : "";
    let available = false;
    try {
      const resolved = resolveSafePath(roots, "output", rawPath);
      available = isFile(resolved) || isDirectory(resolved);
    } catch {
      available = false;
    }
    return { ...ref, available };
  });
}

function healIdFrom(value: unknown) {
  return isRecord(value) && typeof value.heal_id === "string" ? value.heal_id : null;
}

function mergeHealDiagnostics(summary: unknown, events: Array<Record<string, unknown>>) {
  const merged: Record<string, unknown> = isRecord(summary) ? { ...summary } : {};
  const event = [...events].reverse().find(isRecord);
  if (!event) return merged;

  for (const key of ["cli_exit_code", "cli_stderr", "timed_out", "command_missing"] as const) {
    if (merged[key] === undefined && event[key] !== undefined) {
      merged[key] = event[key];
    }
  }
  if (
    merged.error === undefined &&
    typeof event.cli_stderr === "string" &&
    event.cli_stderr &&
    event.status !== "success"
  ) {
    merged.error = event.cli_stderr;
  }
  return merged;
}

function clampQueryInt(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value ?? NaN);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

async function listFlows(config: WebAdminConfig, runner: ReturnType<typeof createFlowRunner>) {
  const flowsDir = path.join(config.repoRoot, "flows");
  if (!existsSync(flowsDir)) return [];
  const runs = await readJsonlSafe<Record<string, unknown>>(path.join(config.dataRoot, "logs", "runs.jsonl"));
  return readdirSync(flowsDir)
    .filter((file) => file.endsWith(".json") && !file.startsWith("_") && !file.startsWith("."))
    .sort()
    .map((file) => {
      try {
        const def = readJsonFile<Record<string, unknown>>(path.join(flowsDir, file));
        const id = String(def.id ?? path.basename(file, ".json"));
        return {
          id,
          name: String(def.name ?? id),
          version: def.version,
          enabled: def.enabled ?? true,
          schedule: def.schedule ?? "",
          description: def.description ?? "",
          params: isRecord(def.params) ? Object.fromEntries(Object.entries(def.params).filter(([key]) => !key.startsWith("_"))) : {},
          file,
          last_run: [...runs].reverse().find((entry) => entry.flow_id === id) ?? null,
          running: runner.isRunning(id)
        };
      } catch {
        return { id: path.basename(file, ".json"), name: path.basename(file, ".json"), file, error: "解析失败" };
      }
    });
}

function validateFlowContent(repoRoot: string, flowId: string, content?: string) {
  if (content === undefined) throw badRequest("content 不能为空");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw badRequest(`JSON 语法错误: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw badRequest("flow 定义必须是 JSON 对象");
  if (parsed.id !== flowId) throw badRequest(`flow 定义的 id 字段必须与文件名一致（${flowId}）`);
  const result = validateFlow(parsed, { repoRoot });
  const errors = result.issues.filter((issue) => issue.level === "error");
  if (!result.ok || errors.length > 0) {
    throw badRequest(`流程校验失败: ${errors.map((issue) => issue.message).join("; ")}`);
  }
  return parsed;
}

function flowTemplateContent(flowId: string, name: string) {
  return `${JSON.stringify(
    {
      id: flowId,
      name,
      version: 1,
      enabled: true,
      schedule: "",
      description: "",
      params: {
        store_name: ""
      },
      steps: [
        {
          id: "start",
          action: "print",
          message: "TODO: replace with verified bridge steps"
        }
      ],
      heal: {
        hints: "TODO: record page entry, selectors, structure and known pitfalls from the verified session"
      }
    },
    null,
    2
  )}\n`;
}

function backupFlow(repoRoot: string, flowId: string) {
  const file = flowFile(repoRoot, flowId);
  const dir = path.join(repoRoot, "flows", ".backup");
  ensureDir(dir);
  const backup = path.join(dir, `${flowId}.${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}.json`);
  writeFileSync(backup, readFileSync(file, "utf8"), "utf8");
}

function flowFile(repoRoot: string, flowId: string) {
  validateFlowId(flowId);
  return path.join(repoRoot, "flows", `${flowId}.json`);
}

function validateFlowId(flowId: unknown) {
  if (typeof flowId !== "string" || !/^[A-Za-z0-9_-]+$/.test(flowId)) {
    throw badRequest(`非法 flow id: ${String(flowId ?? "")}`);
  }
  return flowId;
}

function extractNameFromParams(params: { "*": string }) {
  const name = params["*"] ?? "";
  if (!/^[A-Za-z0-9_.\-/]+$/.test(name) || name.length === 0) {
    throw badRequest(`非法 extract 名称: ${name}`);
  }
  return name;
}

function resolveExtractFile(roots: Record<AllowedRoot, string>, name: string) {
  const file = resolveSafePath(roots, "extracts", name);
  if (isDirectory(file)) throw badRequest(`extract 不能是目录: ${name}`);
  return file;
}

function findExtractRefs(repoRoot: string, flow: Record<string, unknown>) {
  const raw = JSON.stringify(flow);
  const seen = new Set<string>();
  return [...raw.matchAll(/@(extracts\/[A-Za-z0-9_.\-/]+\.js)/g)].flatMap((match) => {
    const rel = match[1]!;
    if (seen.has(rel)) return [];
    seen.add(rel);
    const file = path.join(repoRoot, rel);
    return [{ path: rel, exists: existsSync(file), content: existsSync(file) ? readFileSync(file, "utf8") : null }];
  });
}

async function lastRunOf(dataRoot: string, flowId: string) {
  const runs = await readJsonlSafe<Record<string, unknown>>(path.join(dataRoot, "logs", "runs.jsonl"));
  return [...runs].reverse().find((entry) => entry.flow_id === flowId) ?? null;
}

async function readJsonlSafe<T>(file: string): Promise<T[]> {
  try {
    return await readJsonLinesFile<T>(file);
  } catch {
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as T];
        } catch {
          return [];
        }
      });
  }
}

function allowedRoots(config: WebAdminConfig): Record<AllowedRoot, string> {
  return {
    output: path.join(config.dataRoot, "output"),
    logs: path.join(config.dataRoot, "logs"),
    flows: path.join(config.repoRoot, "flows"),
    extracts: path.join(config.repoRoot, "extracts"),
    static: config.frontendDist
  };
}

function writeSse(reply: FastifyReply, event: unknown) {
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

function renderCommand(command: string[], values: Record<string, string>) {
  return command.map((part) =>
    part.replace(/\{(prompt|prompt_path|session_key)\}/g, (_full, key: string) => values[key] ?? "")
  );
}

function createCommandAgentRunner(): AgentRunner {
  return {
    run(input) {
      return new Promise((resolve) => {
        if (input.command.length === 0) {
          resolve({ exitCode: 1, stderr: "agent command missing", commandMissing: true });
          return;
        }
        const child = spawn(input.command[0]!, input.command.slice(1), {
          stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          resolve({ exitCode: -1, stdout, stderr, timedOut: true });
        }, input.timeoutMs);
        child.stdout.on("data", (chunk) => {
          stdout += String(chunk);
        });
        child.stderr.on("data", (chunk) => {
          stderr += String(chunk);
        });
        child.on("error", (error) => {
          clearTimeout(timer);
          resolve({ exitCode: 127, stdout, stderr: error.message, commandMissing: true });
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({ exitCode: code ?? 0, stdout, stderr });
        });
      });
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
