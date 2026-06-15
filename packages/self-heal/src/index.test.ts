import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readJsonLinesFile } from "@ww-ai-lab/auto-ziniao-core";
import { HealContextSchema, HealEventSchema } from "@ww-ai-lab/auto-ziniao-schemas";
import {
  buildHealPrompt,
  buildTriggerInputFromFailure,
  checkCooldown,
  checkKnownIssues,
  classifyError,
  createCommandAgentRunner,
  DEFAULT_HEAL_CONFIG,
  HealConfig,
  loadHealConfig,
  renderTemplate,
  triggerHeal
} from "./index.js";
import type { AgentRunner, AgentRunResult } from "./index.js";

const fixedClock = { now: () => new Date("2026-06-14T03:04:05Z") };
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempRepoRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ziniao-self-heal-"));
  tempDirs.push(dir);
  return dir;
}

function writeFile(filePath: string, value: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value, "utf8");
}

function testConfig(overrides: Partial<HealConfig["heal"]> = {}): HealConfig {
  return {
    ...DEFAULT_HEAL_CONFIG,
    heal: {
      ...DEFAULT_HEAL_CONFIG.heal,
      agents: { ...DEFAULT_HEAL_CONFIG.heal.agents },
      ...overrides
    }
  };
}

class MockRunner implements AgentRunner {
  calls: Array<{ command: string[]; timeoutMs: number }> = [];

  constructor(
    private readonly result: AgentRunResult = {
      exitCode: 0,
      stdout: "ok",
      stderr: ""
    }
  ) {}

  async run(input: { command: string[]; timeoutMs: number }) {
    this.calls.push(input);
    return this.result;
  }
}

describe("classification and known issues", () => {
  it("classifies explicit context before heuristics", () => {
    expect(
      classifyError({
        error: "unknown",
        toolName: "visit_page",
        healContext: "extract_failed"
      })
    ).toBe("extract_failed");
  });

  it("classifies common error types", () => {
    expect(classifyError({ error: "connection refused" })).toBe("bridge_down");
    expect(classifyError({ error: "timed out" })).toBe("timeout");
    expect(classifyError({ error: "selector not found" })).toBe("element_not_found");
    expect(classifyError({ toolName: "execute_script" })).toBe("extract_failed");
    expect(classifyError({ stepId: "nav_to_orders" })).toBe("nav_failed");
  });

  it("matches only resolved known issues by pattern or flow and step", () => {
    const repoRoot = tempRepoRoot();
    writeFile(
      path.join(repoRoot, "learnings/known_issues.json"),
      JSON.stringify({
        issues: [
          { pattern: "selector changed", resolved: true, flow_id: "orders", step_id: "extract" },
          { pattern: "ignored", resolved: false, flow_id: "orders", step_id: "ignored" }
        ]
      })
    );
    expect(
      checkKnownIssues(
        { flowId: "orders", stepId: "other", error: "selector changed at table" },
        { repoRoot }
      )?.pattern
    ).toBe("selector changed");
    expect(
      checkKnownIssues({ flowId: "orders", stepId: "extract", error: "different" }, { repoRoot })
        ?.pattern
    ).toBe("selector changed");
    expect(
      checkKnownIssues({ flowId: "orders", stepId: "ignored", error: "ignored" }, { repoRoot })
    ).toBeUndefined();
  });

  it("returns no known issue when the file is missing", () => {
    expect(
      checkKnownIssues({ flowId: "orders", stepId: "extract", error: "anything" }, { repoRoot: tempRepoRoot() })
    ).toBeUndefined();
  });
});

describe("prompt rendering and dry-run files", () => {
  it("keeps unknown placeholders", () => {
    expect(renderTemplate("hello {name} {missing_value}", { name: "auto-ziniao" })).toBe(
      "hello auto-ziniao {missing_value}"
    );
  });

  it("uses template lookup precedence and writes schema-compatible files", async () => {
    const repoRoot = tempRepoRoot();
    writeFile(
      path.join(repoRoot, "heal_templates/orders/extract_failed.md"),
      "FLOW TEMPLATE {flow_id} {missing_value}"
    );
    writeFile(path.join(repoRoot, "heal_templates/generic.md"), "GLOBAL TEMPLATE");
    const result = await buildHealPrompt(
      {
        flow_id: "orders",
        flow_name: "订单",
        error: "extract failed",
        params: { store_name: "测试店铺" },
        failed_step: {
          step_id: "extract",
          tool: "execute_script",
          args: { script: "@extracts/orders.js" },
          heal_context: "extract_failed"
        },
        heal_section: { hints: "入口：订单页面" }
      },
      { repoRoot, dataRoot: path.join(repoRoot, "data"), clock: fixedClock }
    );

    const prompt = readFileSync(result.prompt_path, "utf8");
    expect(prompt).toContain("FLOW TEMPLATE orders {missing_value}");
    expect(prompt).toContain("入口：订单页面");
    const context = JSON.parse(readFileSync(result.heal_log_path, "utf8"));
    expect(HealContextSchema.parse(context).context.failed_step).toEqual(
      expect.objectContaining({ step_id: "extract" })
    );
  });

  it("falls back to global generic and builtin templates", async () => {
    const repoRoot = tempRepoRoot();
    writeFile(path.join(repoRoot, "heal_templates/generic.md"), "GLOBAL {flow_id}");
    const globalResult = await buildHealPrompt(
      { flow_id: "orders", error: "unknown", failed_step: { step_id: "x" } },
      { repoRoot, dataRoot: path.join(repoRoot, "data"), clock: fixedClock }
    );
    expect(readFileSync(globalResult.prompt_path, "utf8")).toContain("GLOBAL orders");

    const builtinRepo = tempRepoRoot();
    const builtinResult = await buildHealPrompt(
      { flow_id: "orders", error: "unknown", failed_step: { step_id: "x" } },
      { repoRoot: builtinRepo, dataRoot: path.join(builtinRepo, "data"), clock: fixedClock }
    );
    expect(readFileSync(builtinResult.prompt_path, "utf8")).toContain("诊断方向");
  });
});

describe("config, cooldown, and triggering", () => {
  it("loads config with shallow merge", () => {
    const repoRoot = tempRepoRoot();
    writeFile(
      path.join(repoRoot, "config.json"),
      JSON.stringify({
        heal: {
          agent: "custom",
          cooldown_minutes: 10,
          agents: {
            custom: { command: ["custom-agent", "{flow_id}"], timeout_sec: 1 }
          }
        }
      })
    );
    const config = loadHealConfig({ repoRoot });
    expect(config.heal.agent).toBe("custom");
    expect(config.heal.cooldown_minutes).toBe(10);
    expect(config.heal.agents.openclaw).toBeDefined();
    expect(config.heal.agents.custom?.command).toEqual(["custom-agent", "{flow_id}"]);
  });

  it("enforces cooldown and daily max from jsonl", async () => {
    const repoRoot = tempRepoRoot();
    writeFile(
      path.join(repoRoot, "learnings/heals.jsonl"),
      [
        JSON.stringify({
          event: "triggered",
          flow_id: "orders",
          step_id: "extract",
          timestamp: "2026-06-14T02:30:00.000Z"
        }),
        JSON.stringify({
          event: "triggered",
          flow_id: "orders",
          step_id: "other",
          timestamp: "2026-06-14T02:40:00.000Z"
        })
      ].join("\n") + "\n"
    );
    expect(
      await checkCooldown(
        { flowId: "orders", stepId: "extract", config: testConfig({ max_per_day: 5 }) },
        { repoRoot, clock: fixedClock }
      )
    ).toContain("冷却期");
    expect(
      await checkCooldown(
        { flowId: "orders", stepId: "new", config: testConfig({ max_per_day: 2 }) },
        { repoRoot, clock: fixedClock }
      )
    ).toContain("今日自愈已达上限");
  });

  it("dry-run writes files but does not consume quota or call the runner", async () => {
    const repoRoot = tempRepoRoot();
    const runner = new MockRunner();
    const result = await triggerHeal(
      {
        flow_id: "orders",
        error: "selector not found",
        failed_step: { step_id: "extract", tool: "execute_script" }
      },
      {
        repoRoot,
        dataRoot: path.join(repoRoot, "data"),
        clock: fixedClock,
        config: testConfig(),
        dryRun: true,
        agentRunner: runner
      }
    );
    expect(result.dry_run).toBe(true);
    expect(result.status).toBe("dry_run");
    expect(existsSync(result.prompt_path)).toBe(true);
    expect(existsSync(path.join(repoRoot, "learnings/heals.jsonl"))).toBe(false);
    expect(runner.calls).toHaveLength(0);
  });

  it("skips disabled config and known issues", async () => {
    const disabledRepo = tempRepoRoot();
    const disabled = await triggerHeal(
      { flow_id: "orders", error: "x", failed_step: { step_id: "extract" } },
      {
        repoRoot: disabledRepo,
        dataRoot: path.join(disabledRepo, "data"),
        clock: fixedClock,
        config: testConfig({ enabled: false }),
        agentRunner: new MockRunner()
      }
    );
    expect(disabled.skipped).toBe(true);
    expect(disabled.status).toBe("disabled");
    expect(disabled.reason).toContain("enabled");

    const knownRepo = tempRepoRoot();
    writeFile(
      path.join(knownRepo, "learnings/known_issues.json"),
      JSON.stringify({ issues: [{ pattern: "selector changed", resolved: true }] })
    );
    const known = await triggerHeal(
      { flow_id: "orders", error: "selector changed", failed_step: { step_id: "extract" } },
      {
        repoRoot: knownRepo,
        dataRoot: path.join(knownRepo, "data"),
        clock: fixedClock,
        config: testConfig(),
        agentRunner: new MockRunner()
      }
    );
    expect(known.skipped).toBe(true);
    expect(known.status).toBe("skipped");
    expect(known.reason).toBe("known_issue_matched");
  });

  it("runs a mock agent and records trigger events", async () => {
    const repoRoot = tempRepoRoot();
    const runner = new MockRunner();
    const result = await triggerHeal(
      {
        flow_id: "orders",
        error: "extract failed",
        failed_step: { step_id: "extract", tool: "execute_script" }
      },
      {
        repoRoot,
        dataRoot: path.join(repoRoot, "data"),
        clock: fixedClock,
        config: testConfig({
          agents: {
            mock: { command: ["mock-agent", "{flow_id}", "{heal_id}", "{prompt_path}"], timeout_sec: 2 }
          },
          agent: "mock"
        }),
        agentRunner: runner
      }
    );
    expect(result.success).toBe(true);
    expect(result.status).toBe("success");
    expect(runner.calls[0]?.command[0]).toBe("mock-agent");
    expect(runner.calls[0]?.command[1]).toBe("orders");
    const events = await readJsonLinesFile(path.join(repoRoot, "learnings/heals.jsonl"));
    expect(HealEventSchema.parse(events[0]).event).toBe("triggered");
    expect(HealEventSchema.parse(events[0]).status).toBe("success");
  });

  it("supports command-style codex config through mock AgentRunner", async () => {
    const repoRoot = tempRepoRoot();
    const runner = new MockRunner();
    const result = await triggerHeal(
      {
        flow_id: "orders",
        error: "selector not found",
        failed_step: { step_id: "extract", tool: "execute_script" }
      },
      {
        repoRoot,
        dataRoot: path.join(repoRoot, "data"),
        clock: fixedClock,
        config: testConfig({
          agents: {
            codex: {
              command: ["codex", "exec", "--sandbox", "read-only", "{prompt}", "{session_key}"],
              timeout_sec: 3
            }
          },
          agent: "codex"
        }),
        agentRunner: runner
      }
    );
    expect(result.status).toBe("success");
    expect(result.agent).toBe("codex");
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.command[0]).toBe("codex");
    expect(runner.calls[0]?.command[1]).toBe("exec");
    expect(runner.calls[0]?.command[4]).toContain("selector not found");
    expect(runner.calls[0]?.command[5]).toContain("orders");
  });

  it("returns structured errors for runner failures", async () => {
    const repoRoot = tempRepoRoot();
    const failed = await triggerHeal(
      { flow_id: "orders", error: "x", failed_step: { step_id: "extract" } },
      {
        repoRoot,
        dataRoot: path.join(repoRoot, "data"),
        clock: fixedClock,
        config: testConfig({
          agents: { mock: { command: ["mock-agent"], timeout_sec: 2 } },
          agent: "mock"
        }),
        agentRunner: new MockRunner({ exitCode: 2, stderr: "bad" })
      }
    );
    expect(failed.success).toBe(false);
    expect(failed.status).toBe("failed");
    expect(failed.cli_exit_code).toBe(2);
    expect(failed.cli_stderr).toBe("bad");
    expect(failed.error).toBe("bad");

    const timeoutRepo = tempRepoRoot();
    const timedOut = await triggerHeal(
      { flow_id: "orders", error: "x", failed_step: { step_id: "extract" } },
      {
        repoRoot: timeoutRepo,
        dataRoot: path.join(timeoutRepo, "data"),
        clock: fixedClock,
        config: testConfig({
          agents: { mock: { command: ["mock-agent"], timeout_sec: 2 } },
          agent: "mock"
        }),
        agentRunner: new MockRunner({ exitCode: -1, timedOut: true, stderr: "timeout" })
      }
    );
    expect(timedOut.error).toBe("timeout");
    expect(timedOut.status).toBe("timeout");
    expect(timedOut.timed_out).toBe(true);
    expect(timedOut.cli_exit_code).toBe(-1);
    expect(timedOut.cli_stderr).toBe("timeout");

    const commandMissingRepo = tempRepoRoot();
    const commandMissing = await triggerHeal(
      { flow_id: "orders", error: "x", failed_step: { step_id: "extract" } },
      {
        repoRoot: commandMissingRepo,
        dataRoot: path.join(commandMissingRepo, "data"),
        clock: fixedClock,
        config: testConfig({
          agents: { mock: { command: ["missing-agent"], timeout_sec: 2 } },
          agent: "mock"
        }),
        agentRunner: new MockRunner({ exitCode: 127, commandMissing: true, stderr: "missing-agent not found" })
      }
    );
    expect(commandMissing.success).toBe(false);
    expect(commandMissing.status).toBe("failed");
    expect(commandMissing.command_missing).toBe(true);
    expect(commandMissing.cli_exit_code).toBe(127);
    expect(commandMissing.cli_stderr).toBe("missing-agent not found");

    const longStderrRepo = tempRepoRoot();
    const longStderr = await triggerHeal(
      { flow_id: "orders", error: "x", failed_step: { step_id: "extract" } },
      {
        repoRoot: longStderrRepo,
        dataRoot: path.join(longStderrRepo, "data"),
        clock: fixedClock,
        config: testConfig({
          agents: { mock: { command: ["mock-agent"], timeout_sec: 2 } },
          agent: "mock"
        }),
        agentRunner: new MockRunner({ exitCode: 2, stderr: "x".repeat(600) })
      }
    );
    expect(longStderr.cli_stderr).toHaveLength(500);

    const missingAgentRepo = tempRepoRoot();
    const missingAgent = await triggerHeal(
      { flow_id: "orders", error: "x", failed_step: { step_id: "extract" } },
      {
        repoRoot: missingAgentRepo,
        dataRoot: path.join(missingAgentRepo, "data"),
        clock: fixedClock,
        config: testConfig({ agents: {}, agent: "missing" }),
        agentRunner: new MockRunner()
      }
    );
    expect(missingAgent.success).toBe(false);
    expect(missingAgent.status).toBe("failed");
    expect(missingAgent.error).toContain("missing");
  });

  it("default command runner reports success, failure, timeout, and command missing", async () => {
    const runner = createCommandAgentRunner();
    await expect(
      runner.run({
        command: [process.execPath, "-e", "process.stdout.write('ok')"],
        timeoutMs: 1000
      })
    ).resolves.toEqual(expect.objectContaining({ exitCode: 0, stdout: "ok" }));
    await expect(
      runner.run({
        command: [process.execPath, "-e", "process.stderr.write('bad'); process.exit(2)"],
        timeoutMs: 1000
      })
    ).resolves.toEqual(expect.objectContaining({ exitCode: 2, stderr: "bad" }));
    await expect(
      runner.run({
        command: [process.execPath, "-e", "setTimeout(() => {}, 1000)"],
        timeoutMs: 10
      })
    ).resolves.toEqual(expect.objectContaining({ exitCode: -1, timedOut: true }));
    await expect(
      runner.run({
        command: ["definitely-not-a-ziniao-command"],
        timeoutMs: 1000
      })
    ).resolves.toEqual(expect.objectContaining({ exitCode: 127, commandMissing: true }));
  });
});

describe("flow-engine failure metadata adapter", () => {
  it("preserves failed step, context, store, target, params, and error", async () => {
    const input = buildTriggerInputFromFailure({
      flow: {
        id: "orders",
        name: "订单",
        heal: { hints: "入口：订单" }
      },
      params: { store_name: "测试店铺" },
      result: {
        status: "failed",
        error: "extract failed",
        failed_step: {
          step_id: "extract",
          tool: "execute_script",
          args: { script: "@extracts/orders.js" },
          heal_context: "extract_failed"
        },
        heal: {
          store_id: "store-1",
          target_id: "target-1"
        }
      }
    });
    expect(input.store_id).toBe("store-1");
    expect(input.target_id).toBe("target-1");
    expect(input.params).toEqual({ store_name: "测试店铺" });

    const repoRoot = tempRepoRoot();
    const result = await buildHealPrompt(input, {
      repoRoot,
      dataRoot: path.join(repoRoot, "data"),
      clock: fixedClock
    });
    const context = JSON.parse(readFileSync(result.heal_log_path, "utf8"));
    expect(context.context.failed_step.args.script).toBe("@extracts/orders.js");
    expect(readFileSync(result.prompt_path, "utf8")).toContain("入口：订单");
  });

  it("uses unknown placeholders when failed step is missing", () => {
    const input = buildTriggerInputFromFailure({
      flow: { id: "orders", name: "订单" },
      result: { status: "failed", error: "unknown" }
    });
    expect(input.step_id).toBe("unknown");
    expect(input.tool_name).toBe("unknown");
  });
});
