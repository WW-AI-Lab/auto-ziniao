import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createFlowRunner,
  FlowExecutionRegistry,
  FlowRunFailure,
  FlowRunSuccess,
  FlowToolClient,
  loadFlow,
  parseParams,
  runFlow,
  validateFlow
} from "./index.js";
import { FlowDefinition, FlowRuntimeEventSchema, RunLogEntrySchema } from "@ww-ai-lab/auto-ziniao-schemas";

const repoRoot = process.cwd();
const fixedClock = { now: () => new Date("2026-06-14T03:04:05Z") };
const noopSleeper = async () => {};
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDataRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ziniao-flow-engine-"));
  tempDirs.push(dir);
  return path.join(dir, "data");
}

function readFlowEvents(dataRoot: string) {
  const file = path.join(dataRoot, "logs/flow_events.jsonl");
  return readFileSync(file, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => FlowRuntimeEventSchema.parse(JSON.parse(line)));
}

class MockToolClient implements FlowToolClient {
  calls: Array<{ tool: string; args: Record<string, unknown>; timeoutMs?: number }> = [];
  storeId?: string;
  targetId?: string;
  scriptResponses: unknown[] = [];

  constructor(
    readonly options: {
      stores?: Array<Record<string, unknown>>;
      scriptResponses?: unknown[];
      failTools?: Set<string>;
    } = {}
  ) {
    this.scriptResponses = [...(options.scriptResponses ?? [])];
  }

  async invoke(
    tool: string,
    args: Record<string, unknown> = {},
    timeoutMs?: number
  ): Promise<unknown> {
    this.calls.push({ tool, args, timeoutMs });
    if (this.options.failTools?.has(tool)) {
      throw new Error(`mock failure: ${tool}`);
    }
    if (tool === "list_stores") {
      return { items: this.options.stores ?? [{ storeId: "store-1", name: "first" }] };
    }
    if (tool === "open_store") {
      this.storeId = String(args.storeId ?? "store-1");
      this.targetId = "target-1";
      return { storeId: this.storeId, targetId: this.targetId };
    }
    if (tool === "visit_page") {
      return { data: { targetId: "target-visit" } };
    }
    if (tool === "execute_script") {
      return this.scriptResponses.shift() ?? { url: "https://example.test", rows: [1] };
    }
    if (tool === "take_screenshot") {
      return { data: { filePath: "/tmp/mock.png" } };
    }
    if (tool === "close_store") {
      this.storeId = undefined;
      return { closed: true };
    }
    return { ok: true, tool, args };
  }
}

function localFlow(
  overrides: Partial<Omit<FlowDefinition, "steps">> & {
    steps?: Array<Record<string, unknown>>;
  } = {}
): FlowDefinition {
  return {
    id: "local_flow",
    name: "本地测试流程",
    version: 1,
    enabled: true,
    description: "",
    params: {},
    steps: [],
    ...overrides
  } as unknown as FlowDefinition;
}

describe("flow loader, validator, and params", () => {
  it("loads current flows by id and explicit file path", () => {
    const byId = loadFlow("orders_overview", { repoRoot });
    const byFile = loadFlow(path.join(repoRoot, "flows/orders_overview.json"), {
      repoRoot
    });
    expect(byId.id).toBe("orders_overview");
    expect(byFile.steps.some((step) => step.args?.script === "@extracts/extract_orders_overview.js")).toBe(true);
  });

  it("returns structured validation issues and keeps schema ownership in schemas", () => {
    const invalid = JSON.parse(
      readFileSync(
        path.join(repoRoot, "test/fixtures/flows/invalid/unknown-tool.json"),
        "utf8"
      )
    );
    const result = validateFlow(invalid, { repoRoot });
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "unknown_tool", level: "error" })
    );
  });

  it("parses CLI-style params and rejects invalid pairs", () => {
    expect(parseParams(["store_name=测试店铺", "token=a=b"])).toEqual({
      store_name: "测试店铺",
      token: "a=b"
    });
    expect(() => parseParams(["broken"])).toThrow(/key=value/);
  });

  it("validates current flows correctly", () => {
    for (const flowId of [
      "account_health",
      "inventory_check",
      "orders_overview",
      "switch_language",
      "webadmin_selftest"
    ]) {
      const tsResult = validateFlow(loadFlow(flowId, { repoRoot }), { repoRoot });
      expect(tsResult.ok, `${flowId} should pass TS validation`).toBe(true);
    }
  });
});

describe("runtime context and control flow", () => {
  it("merges params, ignores underscore defaults, and resolves variables", async () => {
    const flow = localFlow({
      params: { greeting: "hello", _comment: "ignored" },
      steps: [
        {
          id: "save",
          action: "save_json",
          data: {
            pure: "${params.greeting}",
            text: "value=${params.greeting}",
            date: "${date}",
            datetime: "${datetime}",
            timestamp: "${timestamp}",
            missing: "${params._comment}"
          },
          filename: "vars_${date}.json"
        }
      ]
    });
    const dataRoot = tempDataRoot();
    const result = await runFlow(flow, {
      params: { greeting: "hi" },
      dataRoot,
      sleeper: noopSleeper,
      clock: fixedClock,
      toolClient: new MockToolClient()
    });
    expect(result.status).toBe("success");
    const saved = JSON.parse(
      readFileSync(path.join(dataRoot, "output/vars_2026-06-14.json"), "utf8")
    );
    expect(saved).toEqual({
      pure: "hi",
      text: "value=hi",
      date: "2026-06-14",
      datetime: "2026-06-14 11:04:05",
      timestamp: "1781406245",
      missing: "${params._comment}"
    });
  });

  it("follows switch_language no-op branch and goto path", async () => {
    const mock = new MockToolClient({
      scriptResponses: [{ lang: "zh-CN" }]
    });
    const result = await runFlow("switch_language", {
      repoRoot,
      dataRoot: tempDataRoot(),
      params: { target_lang: "zh-CN" },
      sleeper: noopSleeper,
      clock: fixedClock,
      toolClient: mock
    });
    expect(result.status).toBe("success");
    expect(mock.calls.map((call) => call.tool)).toEqual([
      "list_stores",
      "open_store",
      "visit_page",
      "execute_script",
      "close_store"
    ]);
  });

  it("stops possible branch loops and records failure metadata", async () => {
    const flow = localFlow({
      steps: [
        {
          id: "loop",
          action: "branch",
          cases: [{ condition: { type: "is_true", left: true }, goto: "loop" }]
        }
      ]
    });
    const result = await runFlow(flow, {
      dataRoot: tempDataRoot(),
      maxExecutions: 3,
      sleeper: noopSleeper,
      clock: fixedClock,
      toolClient: new MockToolClient()
    });
    expect(result.status).toBe("failed");
    expect((result as FlowRunFailure).error).toContain("疑似分支死循环");
  });
});

describe("validation rules and built-in actions", () => {
  it("runs webadmin_selftest with no-op sleep", async () => {
    const result = await runFlow("webadmin_selftest", {
      repoRoot,
      dataRoot: tempDataRoot(),
      params: { greeting: "m3" },
      sleeper: noopSleeper,
      clock: fixedClock,
      toolClient: new MockToolClient()
    });
    expect(result.status).toBe("success");
    expect(Object.keys((result as FlowRunSuccess).data)).toEqual(["say", "wait", "done"]);
  });

  it("writes json and csv outputs with validation", async () => {
    const flow = localFlow({
      steps: [
        {
          id: "json",
          action: "save_json",
          data: [{ url: "https://example.test", value: "a,b" }],
          filename: "out_${date}.json",
          validate: { path: "filePath", not_empty: true }
        },
        {
          id: "csv",
          action: "save_csv",
          header: ["url", "value"],
          data: [["https://example.test", "a,b"]],
          filename: "out_${date}.csv",
          validate: { path: "rows", not_empty: true }
        }
      ]
    });
    const dataRoot = tempDataRoot();
    const result = await runFlow(flow, {
      dataRoot,
      sleeper: noopSleeper,
      clock: fixedClock,
      toolClient: new MockToolClient()
    });
    expect(result.status).toBe("success");
    expect(readFileSync(path.join(dataRoot, "output/out_2026-06-14.csv"), "utf8").charCodeAt(0)).toBe(0xfeff);
  });

  it("returns assertion and validate failures", async () => {
    const assertResult = await runFlow(
      localFlow({
        steps: [{ id: "assert", action: "assert", value: 1, expected: 2, check: "eq" }]
      }),
      {
        dataRoot: tempDataRoot(),
        sleeper: noopSleeper,
        clock: fixedClock,
        toolClient: new MockToolClient()
      }
    );
    expect(assertResult.status).toBe("failed");
    expect((assertResult as FlowRunFailure).failed_step?.step_id).toBe("assert");

    const validateResult = await runFlow(
      localFlow({
        steps: [
          {
            id: "validate",
            action: "print",
            message: "",
            validate: { path: "missing", not_empty: true }
          }
        ]
      }),
      {
        dataRoot: tempDataRoot(),
        sleeper: noopSleeper,
        clock: fixedClock,
        toolClient: new MockToolClient()
      }
    );
    expect(validateResult.status).toBe("failed");
    expect((validateResult as FlowRunFailure).failed_step?.step_id).toBe("validate");
  });
});

describe("tool dispatch and extracts", () => {
  it("chooses storeName param before store_selector first and syncs target state", async () => {
    const mock = new MockToolClient();
    const flow = localFlow({
      params: { store_name: "" },
      steps: [
        { id: "open", tool: "open_store", store_selector: "first", save: "store" },
        {
          id: "visit",
          tool: "visit_page",
          args: { url: "https://example.test" },
          save: "visit"
        },
        { id: "shot", tool: "take_screenshot" },
        { id: "wait", tool: "wait_for_element", args: { selector: "#app" } }
      ]
    });
    const result = await runFlow(flow, {
      params: { store_name: "指定店铺" },
      dataRoot: tempDataRoot(),
      sleeper: noopSleeper,
      clock: fixedClock,
      toolClient: mock
    });
    expect(result.status).toBe("success");
    expect(mock.calls[0]).toMatchObject({
      tool: "open_store",
      args: { storeName: "指定店铺" }
    });
    expect(mock.targetId).toBe("target-visit");
  });

  it("falls back to first storeId and dispatches generic legal tools", async () => {
    const mock = new MockToolClient({
      stores: [{ storeId: "store-first" }]
    });
    const flow = localFlow({
      steps: [
        { id: "stores", tool: "list_stores", save: "stores" },
        { id: "open", tool: "open_store", store_selector: "first" },
        { id: "generic", tool: "query_elements", args: { selector: ".x" } }
      ]
    });
    const result = await runFlow(flow, {
      dataRoot: tempDataRoot(),
      sleeper: noopSleeper,
      clock: fixedClock,
      toolClient: mock
    });
    expect(result.status).toBe("success");
    expect(mock.calls.find((call) => call.tool === "open_store")?.args).toMatchObject({
      storeId: "store-first"
    });
    expect(mock.calls.find((call) => call.tool === "query_elements")).toBeTruthy();
  });

  it("loads extract files as text, substitutes variables, and reports missing extract", async () => {
    const mock = new MockToolClient();
    const result = await runFlow("orders_overview", {
      repoRoot,
      dataRoot: tempDataRoot(),
      sleeper: noopSleeper,
      clock: fixedClock,
      toolClient: mock
    });
    expect(result.status).toBe("success");
    const script = String(mock.calls.find((call) => call.tool === "execute_script")?.args.script);
    expect(script).toContain("return JSON.stringify");

    const missing = await runFlow(
      localFlow({
        steps: [
          {
            id: "extract",
            tool: "execute_script",
            args: { script: "@extracts/not-found.js" }
          }
        ]
      }),
      {
        repoRoot,
        dataRoot: tempDataRoot(),
        sleeper: noopSleeper,
        clock: fixedClock,
        toolClient: new MockToolClient()
      }
    );
    expect(missing.status).toBe("failed");
    expect((missing as FlowRunFailure).error).toContain("脚本文件不存在");
  });
});

describe("run result, logs, retry, and current flow baseline", () => {
  it("writes schema-compatible success and failure logs with truncated summaries", async () => {
    const dataRoot = tempDataRoot();
    const success = await runFlow(
      localFlow({
        steps: [
          {
            id: "save",
            action: "save_json",
            data: { long: "x".repeat(250) },
            filename: "log.json"
          }
        ]
      }),
      {
        dataRoot,
        params: { p: "y".repeat(150) },
        sleeper: noopSleeper,
        clock: fixedClock,
        toolClient: new MockToolClient()
      }
    );
    expect(success.status).toBe("success");

    const failed = await runFlow(
      localFlow({
        steps: [
          {
            id: "fail",
            action: "fail",
            message: "boom",
            on_fail: { action: "heal", context: "extract_failed" }
          }
        ]
      }),
      {
        dataRoot,
        sleeper: noopSleeper,
        clock: fixedClock,
        toolClient: new MockToolClient()
      }
    );
    expect(failed.status).toBe("failed");
    expect((failed as FlowRunFailure).heal?.reason).toBe("m3_metadata_only");

    const lines = readFileSync(path.join(dataRoot, "logs/runs.jsonl"), "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => RunLogEntrySchema.parse(JSON.parse(line)));
    expect(lines.map((line) => line.status)).toEqual(["success", "failed"]);
    expect(lines[0]!.params.p).toHaveLength(100);
    expect(lines[0]!.data_summary.save).toContain("filePath");
  });

  it("handles step retry, skip, branch, abort, and heal metadata", async () => {
    const mock = new MockToolClient({ failTools: new Set(["click_element"]) });
    const flow = localFlow({
      steps: [
        {
          id: "retry",
          tool: "click_element",
          args: { selector: "#retry" },
          on_fail: { action: "retry", maxAttempts: 2, delayMs: 1 }
        }
      ]
    });
    const retryResult = await runFlow(flow, {
      dataRoot: tempDataRoot(),
      sleeper: noopSleeper,
      clock: fixedClock,
      toolClient: mock
    });
    expect(retryResult.status).toBe("failed");
    expect(mock.calls.filter((call) => call.tool === "click_element")).toHaveLength(2);

    const branchResult = await runFlow(
      localFlow({
        steps: [
          {
            id: "bad",
            action: "fail",
            message: "branch",
            on_fail: { action: "branch", target: "ok" }
          },
          { id: "skip_me", action: "fail", message: "should not run" },
          { id: "ok", action: "print", message: "branched" }
        ]
      }),
      {
        dataRoot: tempDataRoot(),
        sleeper: noopSleeper,
        clock: fixedClock,
        toolClient: new MockToolClient()
      }
    );
    expect(branchResult.status).toBe("success");

    const skipResult = await runFlow(
      localFlow({
        steps: [{ id: "skip", action: "fail", message: "skip", on_fail: { action: "skip" } }]
      }),
      {
        dataRoot: tempDataRoot(),
        sleeper: noopSleeper,
        clock: fixedClock,
        toolClient: new MockToolClient()
      }
    );
    expect(skipResult.status).toBe("success");
  });

  it("covers the five current flows with offline semantic golden data", async () => {
    const cases: Array<[string, unknown[]]> = [
      ["orders_overview", [{ url: "https://orders.test" }]],
      ["inventory_check", [{ url: "https://inventory.test" }]],
      ["account_health", ["navigating", { accountHealthRating: 200 }]],
      ["switch_language", [{ lang: "zh-CN" }]],
      ["webadmin_selftest", []]
    ];
    const actual: Record<string, unknown> = {};

    for (const [flowId, scriptResponses] of cases) {
      const dataRoot = tempDataRoot();
      const mock = new MockToolClient({ scriptResponses });
      const result = await runFlow(flowId, {
        repoRoot,
        dataRoot,
        params: { target_lang: "zh-CN", greeting: "offline" },
        sleeper: noopSleeper,
        clock: fixedClock,
        toolClient: mock
      });
      expect(result.status, flowId).toBe("success");
      actual[flowId] = {
        status: result.status,
        tools: mock.calls.map((call) => call.tool),
        outputs: result.status === "success"
          ? Object.entries(result.data)
              .filter(([, value]) => typeof value === "object" && value !== null && "filePath" in value)
              .map(([key]) => key)
          : []
      };
    }

    expect(actual).toEqual({
      account_health: {
        status: "success",
        tools: ["list_stores", "open_store", "visit_page", "execute_script", "execute_script", "close_store"],
        outputs: ["save_health_report"]
      },
      inventory_check: {
        status: "success",
        tools: ["list_stores", "open_store", "visit_page", "execute_script", "close_store"],
        outputs: ["save_inventory"]
      },
      orders_overview: {
        status: "success",
        tools: ["list_stores", "open_store", "visit_page", "execute_script", "close_store"],
        outputs: ["save_orders"]
      },
      switch_language: {
        status: "success",
        tools: ["list_stores", "open_store", "visit_page", "execute_script", "close_store"],
        outputs: []
      },
      webadmin_selftest: {
        status: "success",
        tools: [],
        outputs: []
      }
    });
  });

  it("supports a local-only double-run record for M3", async () => {
    const dataRoot = tempDataRoot();
    const tsResult = await runFlow("webadmin_selftest", {
      repoRoot,
      dataRoot,
      params: { greeting: "double-run" },
      sleeper: noopSleeper,
      clock: fixedClock,
      toolClient: new MockToolClient()
    });
    expect(tsResult.status).toBe("success");

    const logLine = readFileSync(path.join(dataRoot, "logs/runs.jsonl"), "utf8")
      .trim()
      .split(/\r?\n/)
      .at(-1);
    const log = RunLogEntrySchema.parse(JSON.parse(logLine ?? "{}"));
    expect(log.flow_id).toBe("webadmin_selftest");
    expect(log.status).toBe("success");
  });
});

describe("pacing policy runtime", () => {
  it("applies deterministic before and after waits through the injected sleeper", async () => {
    const waits: number[] = [];
    const dataRoot = tempDataRoot();
    const result = await runFlow(
      localFlow({
        pacing: {
          profile: "standard",
          defaults: { write: { afterMs: 2000 } }
        },
        steps: [
          {
            id: "write",
            tool: "click_element",
            risk: "write",
            pacing: { beforeMs: 1000, reason: "test_wait" },
            validate: { path: "ok", not_empty: true }
          }
        ]
      }),
      {
        dataRoot,
        sleeper: async (ms) => {
          waits.push(ms);
        },
        clock: fixedClock,
        toolClient: new MockToolClient()
      }
    );
    expect(result.status).toBe("success");
    expect(waits).toEqual([1000, 2000]);
    expect(readFlowEvents(dataRoot).filter((event) => event.event === "pacing_wait")).toEqual([
      expect.objectContaining({ step_id: "write", wait_ms: 1000, reason: "test_wait" }),
      expect.objectContaining({ step_id: "write", wait_ms: 2000, reason: "test_wait" })
    ]);
  });

  it("rejects unauthorized critical steps before invoking tools and allows explicit authorization", async () => {
    const rejectedMock = new MockToolClient();
    const rejectedDataRoot = tempDataRoot();
    const criticalFlow = localFlow({
      steps: [
        {
          id: "submit",
          tool: "click_element",
          risk: "critical",
          confirm: { allowParam: "allow_submit" },
          pacing: { postconditionExempt: true },
          on_fail: { action: "retry", maxAttempts: 2, delayMs: 1 }
        }
      ]
    });

    const rejected = await runFlow(criticalFlow, {
      dataRoot: rejectedDataRoot,
      sleeper: noopSleeper,
      clock: fixedClock,
      toolClient: rejectedMock
    });
    expect(rejected.status).toBe("failed");
    expect((rejected as FlowRunFailure).failed_step?.step_id).toBe("submit");
    expect(rejectedMock.calls.filter((call) => call.tool === "click_element")).toHaveLength(0);
    expect(readFlowEvents(rejectedDataRoot)).toContainEqual(
      expect.objectContaining({ event: "confirm_rejected", step_id: "submit" })
    );

    const allowedMock = new MockToolClient();
    const allowed = await runFlow(criticalFlow, {
      dataRoot: tempDataRoot(),
      params: { allow_submit: true },
      sleeper: noopSleeper,
      clock: fixedClock,
      toolClient: allowedMock
    });
    expect(allowed.status).toBe("success");
    expect(allowedMock.calls).toContainEqual(expect.objectContaining({ tool: "click_element" }));
  });

  it("rejects per-flow concurrency and releases store locks after failures", async () => {
    const registry = new FlowExecutionRegistry();
    const held = registry.acquire({
      flowId: "local_flow",
      storeKey: "demo_store",
      dateKey: "2026-06-14",
      limits: { perFlowConcurrency: 1 }
    });
    expect(held.ok).toBe(true);

    const rejected = await runFlow(
      localFlow({
        pacing: { limits: { perFlowConcurrency: 1 } },
        params: { store_name: "demo_store" },
        steps: [{ id: "read", action: "print", message: "blocked" }]
      }),
      {
        dataRoot: tempDataRoot(),
        executionRegistry: registry,
        sleeper: noopSleeper,
        clock: fixedClock,
        toolClient: new MockToolClient()
      }
    );
    expect(rejected.status).toBe("failed");
    expect((rejected as FlowRunFailure).error).toContain("per_flow_concurrency");
    if (held.ok) {
      held.release();
    }

    const dataRoot = tempDataRoot();
    const failed = await runFlow(
      localFlow({
        pacing: { limits: { perStoreConcurrency: 1 } },
        params: { store_name: "demo_store" },
        steps: [{ id: "fail", action: "fail", message: "boom" }]
      }),
      {
        dataRoot,
        executionRegistry: registry,
        sleeper: noopSleeper,
        clock: fixedClock,
        toolClient: new MockToolClient()
      }
    );
    expect(failed.status).toBe("failed");
    expect(readFlowEvents(dataRoot)).toContainEqual(
      expect.objectContaining({ event: "store_lock_released", store_name: "demo_store" })
    );

    const afterRelease = await runFlow(
      localFlow({
        pacing: { limits: { perStoreConcurrency: 1 } },
        params: { store_name: "demo_store" },
        steps: [{ id: "ok", action: "print", message: "released" }]
      }),
      {
        dataRoot: tempDataRoot(),
        executionRegistry: registry,
        sleeper: noopSleeper,
        clock: fixedClock,
        toolClient: new MockToolClient()
      }
    );
    expect(afterRelease.status).toBe("success");
  });
});

describe("static bridge boundary", () => {
  it("keeps flow-engine free of direct bridge endpoint literals", () => {
    const source = readFileSync(path.join(repoRoot, "packages/flow-engine/src/index.ts"), "utf8");
    expect(source).not.toContain("tools/invoke");
    expect(source).not.toContain("tools\"");
    expect(source).not.toContain(["127", "0", "0", "1"].join("."));
  });
});
