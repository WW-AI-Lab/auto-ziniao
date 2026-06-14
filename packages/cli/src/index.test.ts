import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { FlowToolClient } from "@ziniao/flow-engine";
import { AgentRunner, AgentRunResult, HealConfig } from "@ziniao/self-heal";

import { runCli } from "./index.js";

type CliResult = {
  code: number;
  stdout: string;
  stderr: string;
};

const fixedClock = { now: () => new Date("2026-06-14T08:00:00.000Z") };

describe("ziniao CLI", () => {
  it("shows help", async () => {
    const repo = createRepo();
    const result = await run(repo, ["--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("ziniao");
    expect(result.stdout).toContain("run");
  });

  it("lists flows and excludes template", async () => {
    const repo = createRepo();
    writeFlow(repo, "orders", {
      id: "orders",
      name: "订单",
      version: 2,
      enabled: true,
      schedule: "*/5 * * * *",
      params: { store_name: "demo" },
      steps: [{ id: "say", action: "print", message: "hello" }]
    });
    const result = await run(repo, ["list"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("orders");
    expect(result.stdout).toContain("订单");
    expect(result.stdout).not.toContain("__FLOW_ID__");
  });

  it("validates flows and treats warnings as success", async () => {
    const repo = createRepo();
    writeFlow(repo, "warn_flow", {
      id: "warn_flow",
      name: "warning",
      version: 1,
      enabled: true,
      schedule: "",
      params: {},
      steps: [
        {
          id: "say",
          action: "print",
          message: "${params.not_declared}"
        }
      ]
    });
    const result = await run(repo, ["validate", "warn_flow"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("[warn]");
  });

  it("fails validate for unknown flow", async () => {
    const repo = createRepo();
    const result = await run(repo, ["validate", "missing"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("流程不存在");
  });

  it("creates a new flow from template and refuses overwrite", async () => {
    const repo = createRepo();
    const first = await run(repo, ["new", "sample", "样例"]);
    expect(first.code).toBe(0);
    const filePath = path.join(repo.root, "flows", "sample.json");
    expect(readFileSync(filePath, "utf8")).toContain("\"id\": \"sample\"");
    expect(readFileSync(filePath, "utf8")).toContain("\"name\": \"样例\"");

    const second = await run(repo, ["new", "sample"]);
    expect(second.code).toBe(1);
    expect(second.stderr).toContain("流程已存在");
  });

  it("reports missing template on new", async () => {
    const repo = createRepo({ withTemplate: false });
    const result = await run(repo, ["new", "sample"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("模板不存在");
  });

  it("enables and disables only the target flow", async () => {
    const repo = createRepo();
    writeFlow(repo, "target", localFlow("target", true));
    writeFlow(repo, "other", localFlow("other", true));
    expect((await run(repo, ["disable", "target"])).code).toBe(0);
    expect(JSON.parse(readFileSync(path.join(repo.root, "flows", "target.json"), "utf8")).enabled).toBe(false);
    expect(JSON.parse(readFileSync(path.join(repo.root, "flows", "other.json"), "utf8")).enabled).toBe(true);

    expect((await run(repo, ["enable", "target"])).code).toBe(0);
    expect(JSON.parse(readFileSync(path.join(repo.root, "flows", "target.json"), "utf8")).enabled).toBe(true);
  });

  it("runs a local flow with params and no real wait", async () => {
    const repo = createRepo();
    writeFlow(repo, "local", {
      ...localFlow("local", true),
      params: { greeting: "hello" },
      steps: [
        { id: "say", action: "print", message: "${params.greeting}" },
        { id: "wait", action: "sleep", seconds: 10 }
      ]
    });
    const result = await run(repo, ["run", "local", "-p", "greeting=hi", "--no-heal"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("执行成功");
    const logs = readFileSync(path.join(repo.dataRoot, "logs", "runs.jsonl"), "utf8");
    expect(logs).toContain("\"flow_id\":\"local\"");
    expect(logs).toContain("\"greeting\":\"hi\"");
  });

  it("returns failure for invalid run params", async () => {
    const repo = createRepo();
    writeFlow(repo, "local", localFlow("local", true));
    const result = await run(repo, ["run", "local", "-p", "bad"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("参数格式非法");
  });

  it("does not trigger self-heal with --no-heal", async () => {
    const repo = createRepo();
    writeFlow(repo, "failing", failingFlow("failing"));
    let calls = 0;
    const result = await run(repo, ["run", "failing", "--no-heal"], {
      agentRunner: runner(() => {
        calls += 1;
        return { exitCode: 0 };
      })
    });
    expect(result.code).toBe(1);
    expect(calls).toBe(0);
    expect(existsSync(path.join(repo.root, "learnings", "heals.jsonl"))).toBe(false);
  });

  it("triggers self-heal with a mock runner after run failure", async () => {
    const repo = createRepo();
    writeFlow(repo, "failing", failingFlow("failing"));
    let calls = 0;
    const result = await run(repo, ["run", "failing"], {
      agentRunner: runner(() => {
        calls += 1;
        return { exitCode: 0 };
      })
    });
    expect(result.code).toBe(1);
    expect(calls).toBe(1);
    expect(result.stderr).toContain("自愈结果");
    expect(readFileSync(path.join(repo.root, "learnings", "heals.jsonl"), "utf8")).toContain("triggered");
  });

  it("supports self-heal dry-run without consuming quota", async () => {
    const repo = createRepo();
    writeFlow(repo, "failing", failingFlow("failing"));
    let calls = 0;
    const result = await run(repo, ["run", "failing", "--heal-dry-run"], {
      agentRunner: runner(() => {
        calls += 1;
        return { exitCode: 0 };
      })
    });
    expect(result.code).toBe(1);
    expect(calls).toBe(0);
    expect(result.stderr).toContain("dry-run");
    expect(existsSync(path.join(repo.root, "learnings", "heals.jsonl"))).toBe(false);
  });

  it("displays known issue and cooldown self-heal skips", async () => {
    const known = createRepo();
    writeFlow(known, "failing", failingFlow("failing"));
    mkdirSync(path.join(known.root, "learnings"), { recursive: true });
    writeFileSync(
      path.join(known.root, "learnings", "known_issues.json"),
      `${JSON.stringify({ issues: [{ pattern: "planned failure", resolved: true }] })}\n`
    );
    const knownResult = await run(known, ["run", "failing"], {
      agentRunner: runner(() => ({ exitCode: 0 }))
    });
    expect(knownResult.stderr).toContain("known_issue_matched");

    const cooldown = createRepo();
    writeFlow(cooldown, "failing", failingFlow("failing"));
    mkdirSync(path.join(cooldown.root, "learnings"), { recursive: true });
    writeFileSync(
      path.join(cooldown.root, "learnings", "heals.jsonl"),
      `${JSON.stringify({
        event: "triggered",
        flow_id: "failing",
        step_id: "boom",
        timestamp: "2026-06-14T07:59:00.000Z"
      })}\n`
    );
    const cooldownResult = await run(cooldown, ["run", "failing"], {
      agentRunner: runner(() => ({ exitCode: 0 }))
    });
    expect(cooldownResult.stderr).toContain("冷却期");
  });

  it("displays self-heal runner failure and timeout", async () => {
    const nonZero = createRepo();
    writeFlow(nonZero, "failing", failingFlow("failing"));
    const nonZeroResult = await run(nonZero, ["run", "failing"], {
      agentRunner: runner(() => ({ exitCode: 2, stderr: "bad" }))
    });
    expect(nonZeroResult.stderr).toContain("自愈失败");

    const timedOut = createRepo();
    writeFlow(timedOut, "failing", failingFlow("failing"));
    const timedOutResult = await run(timedOut, ["run", "failing"], {
      agentRunner: runner(() => ({ exitCode: -1, timedOut: true }))
    });
    expect(timedOutResult.stderr).toContain("CLI timeout");
  });

  it("runs enabled flows only and retries failed history params", async () => {
    const repo = createRepo();
    writeFlow(repo, "enabled", localFlow("enabled", true));
    writeFlow(repo, "disabled", localFlow("disabled", false));
    const all = await run(repo, ["run-all", "--no-heal"]);
    expect(all.code).toBe(0);
    const logText = readFileSync(path.join(repo.dataRoot, "logs", "runs.jsonl"), "utf8");
    expect(logText).toContain("\"flow_id\":\"enabled\"");
    expect(logText).not.toContain("\"flow_id\":\"disabled\"");

    writeFlow(repo, "retry_me", localFlow("retry_me", true));
    appendRunLog(repo, { flow_id: "retry_me", status: "failed", params: { greeting: "again" } });
    const retry = await run(repo, ["retry", "retry_me", "--no-heal"]);
    expect(retry.code).toBe(0);
    expect(readFileSync(path.join(repo.dataRoot, "logs", "runs.jsonl"), "utf8")).toContain("\"greeting\":\"again\"");
  });

  it("handles missing history, successful retry skip, and unknown run flow", async () => {
    const repo = createRepo();
    expect((await run(repo, ["retry", "missing"])).stdout).toContain("没有 missing 的运行记录");
    writeFlow(repo, "done", localFlow("done", true));
    appendRunLog(repo, { flow_id: "done", status: "success", params: {} });
    expect((await run(repo, ["retry", "done"])).stdout).toContain("无需重试");
    expect((await run(repo, ["run", "missing"])).code).toBe(1);
  });

  it("shows history, heals, stats, and cron with missing or invalid logs", async () => {
    const repo = createRepo();
    expect((await run(repo, ["history"])).stdout).toContain("没有运行记录");
    expect((await run(repo, ["heals"])).stdout).toContain("没有自愈记录");
    expect((await run(repo, ["stats"])).stdout).toContain("没有运行记录");

    writeFlow(repo, "scheduled", { ...localFlow("scheduled", true), schedule: "*/10 * * * *" });
    mkdirSync(path.join(repo.dataRoot, "logs"), { recursive: true });
    writeFileSync(
      path.join(repo.dataRoot, "logs", "runs.jsonl"),
      [
        "not-json",
        JSON.stringify({ flow_id: "scheduled", timestamp: "2026-06-14 08:00:00", status: "success", duration_ms: 1, params: {}, data_summary: {} })
      ].join("\n")
    );
    mkdirSync(path.join(repo.root, "learnings"), { recursive: true });
    writeFileSync(
      path.join(repo.root, "learnings", "heals.jsonl"),
      [
        "not-json",
        JSON.stringify({ timestamp: "2026-06-14T08:00:00.000Z", event: "skipped", flow_id: "scheduled", reason: "test" })
      ].join("\n")
    );

    expect((await run(repo, ["history", "scheduled"])).stdout).toContain("scheduled");
    expect((await run(repo, ["heals"])).stdout).toContain("skipped");
    expect((await run(repo, ["stats"])).stdout).toContain("成功");
    const cron = await run(repo, ["cron"]);
    expect(cron.stdout).toContain("python3 manager.py run scheduled");
    expect(cron.stdout).toContain("M5 尚未切换生产入口");
  });
});

function createRepo(options: { withTemplate?: boolean } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "ziniao-cli-"));
  const dataRoot = path.join(root, "data");
  mkdirSync(path.join(root, "flows"), { recursive: true });
  mkdirSync(dataRoot, { recursive: true });
  writeFileSync(path.join(root, "AGENTS.md"), "# test\n");
  if (options.withTemplate !== false) {
    writeFileSync(
      path.join(root, "flows", "_template.json"),
      `${JSON.stringify({
        id: "__FLOW_ID__",
        name: "__FLOW_NAME__",
        version: 1,
        enabled: true,
        schedule: "",
        description: "template",
        params: { store_name: "" },
        steps: [{ id: "say", action: "print", message: "hello" }]
      }, null, 2)}\n`
    );
  }
  return { root, dataRoot };
}

function run(
  repo: { root: string; dataRoot: string },
  argv: string[],
  deps: Partial<Parameters<typeof runCli>[1]> = {}
): Promise<CliResult> {
  let stdout = "";
  let stderr = "";
  return runCli(argv, {
    repoRoot: repo.root,
    dataRoot: repo.dataRoot,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    sleeper: async () => {},
    clock: fixedClock,
    healConfig: testHealConfig(),
    ...deps
  }).then((code) => ({ code, stdout, stderr }));
}

function writeFlow(repo: { root: string }, flowId: string, flow: Record<string, unknown>): void {
  writeFileSync(path.join(repo.root, "flows", `${flowId}.json`), `${JSON.stringify(flow, null, 2)}\n`);
}

function localFlow(id: string, enabled: boolean) {
  return {
    id,
    name: id,
    version: 1,
    enabled,
    schedule: "",
    description: "local",
    params: { greeting: "hello" },
    steps: [{ id: "say", action: "print", message: "${params.greeting}" }],
    on_success: { close_store: false },
    on_fail_final: { close_store: false, heal: true },
    heal: { hints: "test" }
  };
}

function failingFlow(id: string) {
  return {
    ...localFlow(id, true),
    steps: [{ id: "boom", action: "fail", message: "planned failure", on_fail: { action: "abort", context: "generic" } }]
  };
}

function appendRunLog(
  repo: { dataRoot: string },
  entry: { flow_id: string; status: string; params: Record<string, string> }
): void {
  mkdirSync(path.join(repo.dataRoot, "logs"), { recursive: true });
  writeFileSync(
    path.join(repo.dataRoot, "logs", "runs.jsonl"),
    `${JSON.stringify({
      timestamp: "2026-06-14 08:00:00",
      duration_ms: 1,
      error: entry.status === "success" ? null : "failed",
      data_summary: {},
      ...entry
    })}\n`,
    { flag: "a" }
  );
}

function testHealConfig(): HealConfig {
  return {
    heal: {
      enabled: true,
      agent: "mock",
      cooldown_minutes: 60,
      max_per_day: 5,
      agents: {
        mock: {
          command: ["mock-agent", "{prompt_path}"],
          timeout_sec: 1
        }
      }
    }
  };
}

function runner(run: () => AgentRunResult | Promise<AgentRunResult>): AgentRunner {
  return { run: async () => run() };
}
