import { describe, expect, it } from "vitest";

import {
  FlowRuntimeEventSchema,
  HealContextSchema,
  HealEventSchema,
  KnownIssuesFileSchema
} from "./runtime-data.js";

describe("runtime data schemas", () => {
  it("parses heal context with M4 fields and unknown compatibility fields", () => {
    const parsed = HealContextSchema.parse({
      heal_id: "heal_orders_1",
      flow_id: "orders",
      flow_name: "订单",
      step_id: "extract",
      tool_name: "execute_script",
      error_type: "extract_failed",
      error: "selector changed",
      timestamp: "2026-06-14T00:00:00.000Z",
      params: { store_name: "测试店铺" },
      context: { store_id: "s1" },
      prompt_path: "/tmp/prompt.md",
      failed_args: { script: "@extracts/orders.js" },
      screenshot: "/tmp/fail.png",
      future_field: true
    });
    expect(parsed.future_field).toBe(true);
    expect(parsed.params).toEqual({ store_name: "测试店铺" });
  });

  it("parses heal event fields used by TS self-heal", () => {
    const parsed = HealEventSchema.parse({
      event: "triggered",
      heal_id: "heal_orders_1",
      flow_id: "orders",
      step_id: "extract",
      error_type: "extract_failed",
      agent: "openclaw",
      session_key: "auto-ziniao-heal:orders",
      prompt_path: "/tmp/prompt.md",
      heal_log_path: "/tmp/context.json",
      cli_exit_code: 0,
      cli_stderr: ""
    });
    expect(parsed.agent).toBe("openclaw");
    expect(parsed.cli_exit_code).toBe(0);
  });

  it("keeps known issue defaults compatible", () => {
    const parsed = KnownIssuesFileSchema.parse({
      issues: [{ pattern: "selector changed" }]
    });
    expect(parsed.issues[0]?.resolved).toBe(false);
  });

  it("parses flow pacing runtime events", () => {
    const event = FlowRuntimeEventSchema.parse({
      event: "pacing_wait",
      timestamp: "2026-06-14 11:04:05",
      run_id: "run_1",
      flow_id: "orders_overview",
      step_id: "click_filter",
      wait_ms: 1000,
      reason: "after_write",
      future: true
    });
    expect(event.wait_ms).toBe(1000);
    expect(event.future).toBe(true);

    expect(() =>
      FlowRuntimeEventSchema.parse({
        event: "pacing_wait",
        timestamp: "2026-06-14 11:04:05",
        run_id: "run_1"
      })
    ).toThrow(/flow_id/);
  });
});
