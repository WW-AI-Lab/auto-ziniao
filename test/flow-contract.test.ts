import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FlowDefinition,
  FlowDefinitionSchema,
  HealContextSchema,
  KnownIssuesFileSchema,
  RunLogEntrySchema,
  collectExtractRefs,
  getDeclaredParams,
  validateFlowContract
} from "@ww-ai-lab/auto-ziniao-schemas";

const repoRoot = process.cwd();
const flowsDir = path.join(repoRoot, "flows");
const invalidDir = path.join(repoRoot, "test/fixtures/flows/invalid");

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function currentFlowFiles(): string[] {
  return readdirSync(flowsDir)
    .filter((name) => name.endsWith(".json") && !name.startsWith("_"))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => path.join(flowsDir, name));
}

function summarize(flow: FlowDefinition) {
  return {
    id: flow.id,
    version: flow.version,
    enabled: flow.enabled,
    params: [...getDeclaredParams(flow)].sort((a, b) => a.localeCompare(b)),
    stepIds: flow.steps.map((step) => step.id ?? ""),
    tools: [...new Set(flow.steps.map((step) => step.tool).filter(Boolean))].sort(),
    actions: [...new Set(flow.steps.map((step) => step.action).filter(Boolean))].sort(),
    extractRefs: collectExtractRefs(flow)
  };
}

describe("flow contract schemas", () => {
  it("parses all current flows and matches the golden summary", () => {
    const expected = readJson(
      path.join(repoRoot, "test/golden/current-flows.summary.json")
    );
    const actual: Record<string, unknown> = {};

    for (const filePath of currentFlowFiles()) {
      const flow = FlowDefinitionSchema.parse(readJson(filePath));
      const result = validateFlowContract(flow, { repoRoot });
      expect(result.issues.filter((item) => item.level === "error")).toEqual([]);
      actual[flow.id] = summarize(flow);
    }

    expect(actual).toEqual(expected);
  });

  it("keeps newly added current flows in dynamic validation", () => {
    const flowIds = currentFlowFiles().map((filePath) => path.basename(filePath, ".json"));
    expect(flowIds).toEqual([
      "account_health",
      "inventory_check",
      "orders_overview",
      "switch_language",
      "webadmin_selftest"
    ]);
    for (const filePath of currentFlowFiles()) {
      const result = validateFlowContract(readJson(filePath), { repoRoot });
      expect(result.ok, filePath).toBe(true);
    }
  });

  it("validates all current flows via TS schema and contract", () => {
    for (const filePath of currentFlowFiles()) {
      const flowId = path.basename(filePath, ".json");
      const result = validateFlowContract(readJson(filePath), { repoRoot });
      expect(result.ok, `${flowId} should pass TS contract validation`).toBe(true);
    }
  });

  it("validates extract references without executing extract scripts", () => {
    const orders = FlowDefinitionSchema.parse(
      readJson(path.join(flowsDir, "orders_overview.json"))
    );
    expect(collectExtractRefs(orders)).toEqual([
      "@extracts/extract_orders_overview.js"
    ]);
    for (const ref of collectExtractRefs(orders)) {
      expect(existsSync(path.join(repoRoot, ref.slice(1)))).toBe(true);
    }
  });

  it("reports negative fixture issues with stable codes", () => {
    const cases: Array<[string, string, "error" | "warn"]> = [
      ["missing-steps.json", "schema", "error"],
      ["duplicate-step-id.json", "duplicate_step_id", "error"],
      ["unknown-tool.json", "unknown_tool", "error"],
      ["invalid-on-fail.json", "invalid_on_fail", "error"],
      ["missing-target.json", "missing_target", "error"],
      ["undeclared-param.json", "undeclared_param", "warn"],
      ["missing-extract.json", "missing_extract", "error"]
    ];

    for (const [fixture, code, level] of cases) {
      const result = validateFlowContract(readJson(path.join(invalidDir, fixture)), {
        repoRoot
      });
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code, level })
      );
      if (fixture === "undeclared-param.json") {
        expect(result.issues.some((item) => item.level === "error")).toBe(false);
      }
    }
  });

  it("parses runtime data samples with optional defaults", () => {
    const runLine = readFileSync(path.join(repoRoot, "data/logs/runs.jsonl"), "utf8")
      .split(/\r?\n/)
      .find(Boolean);
    expect(runLine).toBeTruthy();
    const run = RunLogEntrySchema.parse(JSON.parse(runLine ?? "{}"));
    expect(run.flow_id).toBeTruthy();
    expect(run.params).toBeDefined();
    expect(run.data_summary).toBeDefined();

    const knownIssues = KnownIssuesFileSchema.parse(
      readJson(path.join(repoRoot, "learnings/known_issues.json"))
    );
    expect(Array.isArray(knownIssues.issues)).toBe(true);

    const heal = HealContextSchema.parse(
      readJson(path.join(repoRoot, "data/logs/heals/heal_account_health_1781253237.json"))
    );
    expect(heal.heal_id).toBe("heal_account_health_1781253237");
  });
});
