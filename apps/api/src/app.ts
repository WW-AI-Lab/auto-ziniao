import { createReadStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import Fastify, { FastifyInstance, FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";

import { ensureDir, readJsonFile, readJsonLinesFile, writeJsonFile } from "@ziniao/core";
import { validateFlow } from "@ziniao/flow-engine";
import { AgentRunner } from "@ziniao/self-heal";

import { createConfig, getHealConfig, WebAdminConfig } from "./config.js";
import { badRequest, conflict, notFound, ApiError } from "./errors.js";
import { createFlowRunner } from "./runner.js";
import { createScheduler } from "./scheduler.js";
import { resolveSafePath, isDirectory, isFile, AllowedRoot } from "./security.js";
import { createStorage, Storage } from "./storage.js";
import { computeNextRun, validateTrigger, TriggerError } from "./triggers.js";

export type CreateAppOptions = {
  config?: Partial<WebAdminConfig>;
  storage?: Storage;
  runner?: ReturnType<typeof createFlowRunner>;
  agentRunner?: AgentRunner;
  startScheduler?: boolean;
};

export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const config = createConfig(options.config);
  const storage = options.storage ?? createStorage(path.join(config.dataRoot, "webadmin.db"));
  const runner =
    options.runner ??
    createFlowRunner({
      repoRoot: config.repoRoot,
      dataRoot: config.dataRoot,
      timeoutMs: config.flowTimeoutMs
    });
  const scheduler = createScheduler({ storage, runner });
  const app = Fastify({ logger: false });
  const roots = allowedRoots(config);
  const busySessions = new Set<string>();
  const agentRunner = options.agentRunner ?? createCommandAgentRunner();

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

  registerFlowRoutes(app, { config, roots, runner });
  registerMonitoringRoutes(app, { config, roots, storage });
  registerScheduleRoutes(app, { config, storage, scheduler });
  registerChatRoutes(app, { config, storage, busySessions, agentRunner });
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
  deps: { config: WebAdminConfig; roots: Record<AllowedRoot, string>; runner: ReturnType<typeof createFlowRunner> }
) {
  app.get("/api/flows", async () => ({ items: await listFlows(deps.config, deps.runner) }));

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
    if (!entry) throw notFound(`运行记录不存在: ${request.params.token}`);
    return entry;
  });
}

function registerMonitoringRoutes(
  app: FastifyInstance,
  deps: { config: WebAdminConfig; roots: Record<AllowedRoot, string>; storage: Storage }
) {
  app.get<{ Querystring: { flow_id?: string; limit?: string; offset?: string } }>("/api/runs", async (request) => {
    const entries = await readJsonlSafe<Record<string, unknown>>(path.join(deps.config.dataRoot, "logs", "runs.jsonl"));
    const filtered = request.query.flow_id ? entries.filter((entry) => entry.flow_id === request.query.flow_id) : entries;
    const items = filtered.reverse().slice(Number(request.query.offset ?? 0), Number(request.query.offset ?? 0) + Number(request.query.limit ?? 50));
    return { total: filtered.length, items };
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
    return {
      items: deps.storage.listScheduleRuns(request.params.sid, Number(request.query.limit ?? 20), Number(request.query.offset ?? 0))
    };
  });
}

function registerChatRoutes(
  app: FastifyInstance,
  deps: { config: WebAdminConfig; storage: Storage; busySessions: Set<string>; agentRunner: AgentRunner }
) {
  app.get("/api/chat/agents", async () => {
    const cfg = getHealConfig(deps.config.repoRoot);
    return {
      default: cfg.defaultAgent,
      items: Object.entries(cfg.agents).map(([name, agent]) => ({ name, timeout_sec: agent.timeout_sec }))
    };
  });

  app.get("/api/chat/sessions", async () => ({
    items: deps.storage.listSessions().map((session) => ({ ...session, busy: deps.busySessions.has(String(session.id)) }))
  }));

  app.post<{ Body: { title?: string; agent?: string } }>("/api/chat/sessions", async (request) => {
    const cfg = getHealConfig(deps.config.repoRoot);
    const agent = request.body?.agent ?? cfg.defaultAgent;
    if (!cfg.agents[agent]) throw badRequest(`config.json 中未配置 agent: ${agent}`);
    return deps.storage.createSession(request.body?.title?.trim() || "新会话", agent);
  });

  app.put<{ Params: { sid: string }; Body: { title?: string; agent?: string } }>("/api/chat/sessions/:sid", async (request) => {
    if (!deps.storage.getSession(request.params.sid)) throw notFound(`会话不存在: ${request.params.sid}`);
    if (request.body.agent && !getHealConfig(deps.config.repoRoot).agents[request.body.agent]) {
      throw badRequest(`config.json 中未配置 agent: ${request.body.agent}`);
    }
    return deps.storage.updateSession(request.params.sid, request.body);
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
      const cfg = getHealConfig(deps.config.repoRoot).agents[String(session.agent)];
      const result = await deps.agentRunner.run({
        command: renderCommand(cfg?.command ?? [], {
          prompt: content,
          prompt_path: "",
          session_key: `ziniao-webadmin:${request.params.sid}`
        }),
        timeoutMs: (cfg?.timeout_sec ?? 60) * 1000
      });
      if (result.exitCode === 0) {
        const text = result.stdout || "OK";
        writeSse(reply, { type: "delta", session_id: request.params.sid, message_id: assistantId, text });
        deps.storage.updateMessage(assistantId, { content: text, status: "done" });
        writeSse(reply, { type: "done", session_id: request.params.sid, message_id: assistantId, content: text });
      } else {
        const message = result.timedOut ? "Agent CLI timeout" : result.stderr || `Agent CLI exit ${result.exitCode}`;
        deps.storage.updateMessage(assistantId, { status: "failed", error: message });
        writeSse(reply, { type: "error", session_id: request.params.sid, message_id: assistantId, message });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.storage.updateMessage(assistantId, { status: "failed", error: message });
      writeSse(reply, { type: "error", session_id: request.params.sid, message_id: assistantId, message });
    } finally {
      deps.busySessions.delete(request.params.sid);
      reply.raw.end();
    }
  });
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

function backupFlow(repoRoot: string, flowId: string) {
  const file = flowFile(repoRoot, flowId);
  const dir = path.join(repoRoot, "flows", ".backup");
  ensureDir(dir);
  const backup = path.join(dir, `${flowId}.${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}.json`);
  writeFileSync(backup, readFileSync(file, "utf8"), "utf8");
}

function flowFile(repoRoot: string, flowId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(flowId)) throw notFound(`流程不存在: ${flowId}`);
  return path.join(repoRoot, "flows", `${flowId}.json`);
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
