import { describe, expect, it } from "vitest";

import {
  ApiErrorResponseSchema,
  ChatAgentInfoSchema,
  ChatSseEventSchema,
  FlowDetailSchema,
  FlowSummarySchema,
  HealDetailSchema,
  HealEntrySchema,
  ManualRunStatusSchema,
  OutputDirectorySchema,
  OutputPreviewSchema,
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
    expect(ManualRunStatusSchema.parse({ token: "t", flow_id: "orders", status: "running" }).params).toEqual({});
    expect(OutputDirectorySchema.parse({ path: "", dirs: [], files: [{ name: "a.json", size: 1 }] }).files[0]?.name).toBe("a.json");
    expect(OutputPreviewSchema.parse({ size: 1, content: "ok" }).content).toBe("ok");
    expect(ChatAgentInfoSchema.parse({ name: "mock", timeout_sec: 1 }).name).toBe("mock");
    expect(ChatSseEventSchema.parse({ type: "delta", text: "hi" }).type).toBe("delta");
    expect(ChatSseEventSchema.parse({ type: "reasoning_delta", text: "thinking" }).type).toBe("reasoning_delta");
    expect(ChatSseEventSchema.parse({ type: "tool_call", name: "mock" }).type).toBe("tool_call");
    expect(ChatSseEventSchema.parse({ type: "heartbeat" }).type).toBe("heartbeat");
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

  it("parses stable error response without requiring stack or secret", () => {
    const parsed = ApiErrorResponseSchema.parse({
      error: { code: "bad_request", message: "请求错误" }
    });
    expect(parsed.error.code).toBe("bad_request");
    expect(JSON.stringify(parsed)).not.toContain("secret");
  });
});
