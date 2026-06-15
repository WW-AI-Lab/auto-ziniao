import { describe, expect, it } from "vitest";

import {
  ApiErrorResponseSchema,
  ChatAgentInfoSchema,
  ChatPreferenceSchema,
  ChatExtrasSchema,
  ChatMessageSchema,
  ChatSseEventSchema,
  CreateFlowRequestSchema,
  CreateFlowResponseSchema,
  ExtractDetailSchema,
  FlowRunDetailSchema,
  FlowRunHistoryItemSchema,
  FlowDetailSchema,
  FlowSummarySchema,
  FlowTemplateResponseSchema,
  HealDetailSchema,
  HealEntrySchema,
  HealSummarySchema,
  ManualRunStatusSchema,
  OutputRefSchema,
  OutputDirectorySchema,
  OutputPreviewSchema,
  SaveExtractRequestSchema,
  ScheduleRunSchema,
  ScheduleSchema,
  WebAdminStatsSchema
} from "./webadmin.js";

describe("webadmin api schemas", () => {
  it("parses schedule and schedule run DTOs with extension fields", () => {
    const schedule = ScheduleSchema.parse({
      id: "s1",
      name: "任务",
      flow_id: "orders",
      params: { store_name: "demo" },
      trigger: { type: "interval", minutes: 5 },
      enabled: true,
      next_run_at: "2026-06-15T00:00:00.000Z",
      created_at: "2026-06-15T00:00:00.000Z",
      updated_at: "2026-06-15T00:00:00.000Z",
      latest_run: {
        schedule_id: "s1",
        fired_at: "2026-06-15T00:00:00.000Z",
        status: "success"
      },
      future: true
    });
    expect(schedule.future).toBe(true);
    expect(schedule.params.store_name).toBe("demo");

    const run = ScheduleRunSchema.parse({
      schedule_id: "s1",
      fired_at: "2026-06-15T00:00:00.000Z",
      status: "skipped",
      duration_ms: 1,
      error: null
    });
    expect(run.status).toBe("skipped");
  });

  it("parses flow, output, run status and SSE DTOs", () => {
    expect(FlowSummarySchema.parse({ id: "orders", name: "订单", params: {}, extra: 1 }).extra).toBe(1);
    expect(FlowDetailSchema.parse({ id: "orders", content: "{}", extracts: [] }).extracts).toEqual([]);
    const manual = ManualRunStatusSchema.parse({
      token: "t",
      run_id: "run_1",
      flow_id: "orders",
      status: "running",
      heal_summary: { status: "not_triggered" }
    });
    expect(manual.params).toEqual({});
    expect(manual.run_id).toBe("run_1");
    expect(OutputDirectorySchema.parse({ path: "", dirs: [], files: [{ name: "a.json", size: 1 }] }).files[0]?.name).toBe("a.json");
    expect(OutputPreviewSchema.parse({ size: 1, content: "ok" }).content).toBe("ok");
    expect(OutputRefSchema.parse({ name: "a.json", path: "a.json" }).available).toBe(true);
    const agent = ChatAgentInfoSchema.parse({
      name: "codex",
      type: "codex-cli",
      label: "Codex",
      timeout_sec: 120,
      available: true,
      source: "discovered",
      capabilities: ["chat"]
    });
    expect(agent.name).toBe("codex");
    expect(agent.type).toBe("codex-cli");
    expect(agent.capabilities).toContain("chat");
    const unavailable = ChatAgentInfoSchema.parse({
      name: "future",
      type: "future-cli",
      timeout_sec: 30,
      available: false,
      diagnostic: { code: "command_missing", message: "missing" }
    });
    expect(unavailable.available).toBe(false);
    expect(ChatPreferenceSchema.parse({ default_agent: "codex" }).default_agent).toBe("codex");
    expect(ChatSseEventSchema.parse({ type: "delta", text: "hi" }).type).toBe("delta");
    expect(ChatSseEventSchema.parse({ type: "reasoning_delta", text: "thinking" }).type).toBe("reasoning_delta");
    expect(ChatSseEventSchema.parse({ type: "tool_call", name: "mock" }).type).toBe("tool_call");
    const tool = ChatSseEventSchema.parse({
      type: "tool_call",
      name: "query_orders",
      status: "success",
      args_summary: "store=demo",
      result_summary: "2 rows"
    });
    expect(tool.type).toBe("tool_call");
    if (tool.type === "tool_call") {
      expect(tool.status).toBe("success");
      expect(tool.result_summary).toBe("2 rows");
    }
    const a2ui = ChatSseEventSchema.parse({
      type: "a2ui",
      block: {
        type: "table",
        title: "订单",
        columns: ["id", "status"],
        rows: [{ id: "o1", status: "paid" }]
      }
    });
    expect(a2ui.type).toBe("a2ui");
    expect(ChatSseEventSchema.parse({ type: "heartbeat" }).type).toBe("heartbeat");
  });

  it("parses rich chat extras and older chat messages without extras", () => {
    const extras = ChatExtrasSchema.parse({
      reasoning: "先检查订单状态",
      tools: [{
        id: "tool_1",
        name: "query_orders",
        status: "success",
        args_summary: "store=demo",
        result_summary: "2 rows",
        vendor_meta: true
      }],
      a2ui: [
        { type: "alert", level: "info", text: "需要人工确认" },
        { type: "unknown-card", payload: { safe: true } }
      ],
      future: true
    });
    expect(extras.tools?.[0]?.status).toBe("success");
    expect(extras.tools?.[0]?.vendor_meta).toBe(true);
    expect(extras.a2ui?.[1]?.type).toBe("unknown-card");
    expect(extras.future).toBe(true);

    const oldMessage = ChatMessageSchema.parse({
      id: 1,
      session_id: "s1",
      role: "assistant",
      content: "旧消息",
      status: "done",
      error: null,
      created_at: "2026-06-15T00:00:00.000Z"
    });
    expect(oldMessage.extras).toBeUndefined();
  });

  it("parses WebAdmin monitoring DTOs", () => {
    expect(HealEntrySchema.parse({ heal_id: "h1", flow_id: "orders", extra: true }).extra).toBe(true);
    expect(HealDetailSchema.parse({ heal_id: "h1", context: { ok: true }, prompt: null }).context?.ok).toBe(true);
    const stats = WebAdminStatsSchema.parse({
      runs_total: 2,
      runs_success: 1,
      runs_failed: 1,
      runs_error: 0,
      heals_total: 1,
      schedules: { total: 1, enabled: 1 },
      chat_sessions: 1,
      flows: [{ flow_id: "orders", total: 2, success: 1, success_rate: 50, last_run: "t", last_status: "failed", heal_count: 1 }]
    });
    expect(stats.flows[0]?.heal_count).toBe(1);
  });

  it("parses WebAdmin flow run observability DTOs", () => {
    const success = FlowRunHistoryItemSchema.parse({
      run_id: "run_success",
      source: "manual",
      flow_id: "account_health",
      params: { store_name: "demo" },
      status: "success",
      started_at: "2026-06-15T00:00:00.000Z",
      duration_ms: 12,
      data_summary: { save: "1 rows" },
      output_refs: [{ name: "health.json", path: "account_health/health.json" }]
    });
    expect(success.output_refs[0]?.available).toBe(true);
    expect(success.detail_available).toBe(true);

    const failed = FlowRunDetailSchema.parse({
      run_id: "run_failed",
      token: "token1",
      source: "schedule",
      flow_id: "account_health",
      schedule_id: "sched1",
      schedule_run_id: 3,
      status: "failed",
      error: "extract failed",
      failed_step: { step_id: "extract_health", tool: "execute_script" },
      heal_summary: {
        status: "triggered",
        heal_id: "heal_account_health_1",
        error_type: "extract_failed",
        agent: "openclaw",
        prompt_path: "/tmp/prompt.md",
        heal_log_path: "/tmp/context.json"
      },
      heal_events: [{ event: "triggered", heal_id: "heal_account_health_1" }],
      heal_context: null,
      result: { status: "failed" }
    });
    expect(failed.failed_step?.step_id).toBe("extract_health");
    expect(failed.heal_summary?.agent).toBe("openclaw");

    const missing = FlowRunDetailSchema.parse({
      run_id: "history_local_t",
      source: "history",
      flow_id: "local",
      status: "failed",
      data_summary: {},
      output_refs: [],
      detail_available: false,
      heal_summary: { status: "failed", error: "context missing", context_available: false }
    });
    expect(missing.detail_available).toBe(false);

    expect(HealSummarySchema.parse({ status: "skipped", reason: "known_issue_matched" }).reason).toBe("known_issue_matched");
    expect(HealSummarySchema.parse({ status: "failed", error: "Agent CLI timeout" }).status).toBe("failed");
  });

  it("parses stable error response without requiring stack or secret", () => {
    const parsed = ApiErrorResponseSchema.parse({
      error: { code: "bad_request", message: "请求错误" }
    });
    expect(parsed.error.code).toBe("bad_request");
    expect(JSON.stringify(parsed)).not.toContain("secret");
  });

  it("parses flow authoring DTOs", () => {
    const request = CreateFlowRequestSchema.parse({
      id: "sample_flow",
      name: "样例流程",
      content: "{\"id\":\"sample_flow\"}"
    });
    expect(request.id).toBe("sample_flow");
    expect(request.content).toContain("sample_flow");

    const response = CreateFlowResponseSchema.parse({
      id: "sample_flow",
      name: "样例流程",
      content: "{}"
    });
    expect(response.created).toBe(true);
    expect(response.warnings).toEqual([]);

    expect(SaveExtractRequestSchema.parse({ content: "(() => JSON.stringify({ ok: true }))();" }).content).toContain("JSON");
    expect(ExtractDetailSchema.parse({ name: "sample.js", path: "extracts/sample.js", exists: false, content: null }).content).toBeNull();
    expect(FlowTemplateResponseSchema.parse({ content: "{}" }).content).toBe("{}");
  });
});
