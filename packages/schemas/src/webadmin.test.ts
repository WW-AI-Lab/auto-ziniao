import { describe, expect, it } from "vitest";

import {
  ApiErrorResponseSchema,
  ChatSseEventSchema,
  FlowDetailSchema,
  FlowSummarySchema,
  ManualRunStatusSchema,
  OutputDirectorySchema,
  ScheduleRunSchema,
  ScheduleSchema
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
      latest_run: { status: "success" },
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
    expect(ChatSseEventSchema.parse({ type: "delta", text: "hi" }).type).toBe("delta");
    expect(ChatSseEventSchema.parse({ type: "heartbeat" }).type).toBe("heartbeat");
  });

  it("parses stable error response without requiring stack or secret", () => {
    const parsed = ApiErrorResponseSchema.parse({
      error: { code: "bad_request", message: "请求错误" }
    });
    expect(parsed.error.code).toBe("bad_request");
    expect(JSON.stringify(parsed)).not.toContain("secret");
  });
});
