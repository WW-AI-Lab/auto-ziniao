import { FlowDefinition } from "@ziniao/schemas";
import { loadFlow, runFlow, FlowToolClient, FlowRunFailure, FlowRunResult } from "@ziniao/flow-engine";
import { AgentRunner, buildTriggerInputFromFailure, HealConfig, triggerHeal, TriggerHealResult } from "@ziniao/self-heal";
import { Storage } from "./storage.js";

export type Clock = { now(): Date };

export type RunEntry = {
  token: string;
  run_id?: string;
  flow_id: string;
  params: Record<string, string>;
  status: string;
  started_at: string;
  finished_at?: string | null;
  exit_code?: number | null;
  duration_ms?: number | null;
  output?: string;
  error?: string | null;
  result?: FlowRunResult;
  heal_summary?: Record<string, unknown> | null;
};

export type FlowRunExecution = {
  status: string;
  error: string | null;
  exit_code: number | null;
  duration_ms: number;
  result?: FlowRunResult;
  run_id?: string;
  heal_result?: TriggerHealResult;
  heal_summary?: Record<string, unknown> | null;
};

export type FlowRunnerDeps = {
  repoRoot: string;
  dataRoot: string;
  storage?: Storage;
  agentRunner?: AgentRunner;
  healConfig?: HealConfig;
  toolClient?: FlowToolClient;
  sleeper?: (ms: number) => Promise<void>;
  clock?: Clock;
  timeoutMs?: number;
};

export function createFlowRunner(deps: FlowRunnerDeps) {
  const running = new Set<string>();
  const runs = new Map<string, RunEntry>();
  const clock = deps.clock ?? { now: () => new Date() };

  async function execute(
    flowId: string,
    params: Record<string, string> = {},
    meta: { source?: string; token?: string; schedule_id?: string | null; run_id?: string } = {}
  ): Promise<FlowRunExecution> {
    if (running.has(flowId)) {
      const skipped = {
        status: "skipped",
        error: `flow ${flowId} 已有运行中实例`,
        exit_code: null,
        duration_ms: 0,
        heal_summary: { status: "not_triggered", reason: "duplicate_running_flow" }
      };
      if (deps.storage) {
        const run = deps.storage.createFlowRun({
          run_id: meta.run_id,
          token: meta.token ?? null,
          source: meta.source ?? "manual",
          flow_id: flowId,
          schedule_id: meta.schedule_id ?? null,
          params,
          status: "skipped",
          started_at: clock.now().toISOString()
        });
        deps.storage.updateFlowRun(run.run_id, {
          finished_at: clock.now().toISOString(),
          duration_ms: 0,
          error: skipped.error,
          heal_summary: skipped.heal_summary
        });
        return { ...skipped, run_id: run.run_id };
      }
      return skipped;
    }
    const flow = loadFlow(flowId, { repoRoot: deps.repoRoot });
    const run =
      deps.storage?.createFlowRun({
        run_id: meta.run_id,
        token: meta.token ?? null,
        source: meta.source ?? "manual",
        flow_id: flowId,
        schedule_id: meta.schedule_id ?? null,
        params,
        status: "running",
        started_at: clock.now().toISOString()
      }) ?? null;
    running.add(flowId);
    const started = Date.now();
    try {
      const result = await runFlow(flowId, {
        repoRoot: deps.repoRoot,
        dataRoot: deps.dataRoot,
        params,
        toolClient: deps.toolClient,
        sleeper: deps.sleeper,
        clock,
        heal: true
      });
      const failed = result.status !== "success";
      const execution: FlowRunExecution = {
        status: failed ? result.status : "success",
        error: failed ? result.error : null,
        exit_code: failed ? 1 : 0,
        duration_ms: Date.now() - started,
        result,
        run_id: run?.run_id
      };
      if (failed && shouldTriggerHeal(flow, result)) {
        try {
          const healResult = await triggerHeal(
            buildTriggerInputFromFailure({ flow, result, params }),
            {
              repoRoot: deps.repoRoot,
              dataRoot: deps.dataRoot,
              agentRunner: deps.agentRunner,
              config: deps.healConfig,
              clock
            }
          );
          execution.heal_result = healResult;
          execution.heal_summary = healSummaryFromResult(healResult);
        } catch (error) {
          execution.heal_summary = {
            status: "failed",
            error: error instanceof Error ? error.message : String(error)
          };
        }
      } else if (failed) {
        execution.heal_summary = disabledHealSummary(flow, result);
      } else {
        execution.heal_summary = { status: "not_triggered" };
      }
      if (run) {
        deps.storage!.updateFlowRun(run.run_id, {
          status: execution.status,
          finished_at: clock.now().toISOString(),
          exit_code: execution.exit_code,
          duration_ms: execution.duration_ms,
          error: execution.error,
          result,
          failed_step: failed ? result.failed_step ?? null : null,
          data_summary: result.status === "success" ? summarizeData(result.data) : {},
          output_refs: outputRefsFromResult(result),
          heal_result: execution.heal_result ?? null,
          heal_summary: execution.heal_summary ?? null
        });
      }
      return execution;
    } catch (error) {
      const execution: FlowRunExecution = {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        exit_code: 1,
        duration_ms: Date.now() - started,
        run_id: run?.run_id,
        heal_summary: { status: "not_triggered", reason: "runner_exception" }
      };
      if (run) {
        deps.storage!.updateFlowRun(run.run_id, {
          status: execution.status,
          finished_at: clock.now().toISOString(),
          exit_code: execution.exit_code,
          duration_ms: execution.duration_ms,
          error: execution.error,
          heal_summary: execution.heal_summary
        });
      }
      return execution;
    } finally {
      running.delete(flowId);
    }
  }

  return {
    isRunning: (flowId: string) => running.has(flowId),
    runs,
    async execute(
      flowId: string,
      params: Record<string, string> = {},
      meta: { source?: string; token?: string; schedule_id?: string | null; run_id?: string } = {}
    ) {
      return execute(flowId, params, meta);
    },
    start(flowId: string, params: Record<string, string> = {}) {
      if (running.has(flowId)) {
        throw new Error(`flow ${flowId} 已有运行中实例`);
      }
      const token = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
      const runId = `run_${token}`;
      const entry: RunEntry = {
        token,
        run_id: runId,
        flow_id: flowId,
        params,
        status: "running",
        started_at: clock.now().toISOString(),
        finished_at: null,
        exit_code: null,
        duration_ms: null,
        output: "",
        error: null
      };
      runs.set(token, entry);
      void execute(flowId, params, { source: "manual", token, run_id: runId }).then((result) => {
        Object.assign(entry, {
          run_id: result.run_id ?? runId,
          status: result.status,
          finished_at: clock.now().toISOString(),
          exit_code: result.exit_code,
          duration_ms: result.duration_ms,
          error: result.error ?? null,
          result: result.result,
          heal_summary: result.heal_summary ?? null
        });
      });
      return { token, run_id: runId, flow_id: flowId, status: "running" };
    },
    get(token: string) {
      return runs.get(token) ?? null;
    }
  };
}

function shouldTriggerHeal(flow: FlowDefinition, result: FlowRunFailure): boolean {
  if (flow.on_fail_final?.heal === false) return false;
  const reason = isRecord(result.heal) ? result.heal.reason : undefined;
  return reason !== "validation_failed" && reason !== "disabled_by_flow";
}

function disabledHealSummary(flow: FlowDefinition, result: FlowRunFailure) {
  if (flow.on_fail_final?.heal === false) return { status: "disabled", reason: "disabled_by_flow" };
  const reason = isRecord(result.heal) && typeof result.heal.reason === "string" ? result.heal.reason : "not_triggerable";
  return { status: "not_triggered", reason };
}

function healSummaryFromResult(result: TriggerHealResult) {
  let status = result.status ?? "triggered";
  if (!result.status) {
    if (result.dry_run) status = "dry_run";
    else if (result.skipped) status = "skipped";
    else if (result.success === true) status = "success";
    else if (result.success === false) status = result.error?.toLowerCase().includes("timeout") ? "timeout" : "failed";
  }
  return {
    status,
    heal_id: result.heal_id,
    error_type: result.error_type,
    agent: result.agent,
    reason: result.reason,
    error: result.error,
    prompt_path: result.prompt_path,
    heal_log_path: result.heal_log_path,
    detail_url: `/api/heals/${result.heal_id}`
  };
}

function summarizeData(data: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, summaryValue(value)]));
}

function outputRefsFromResult(result: FlowRunResult) {
  if (result.status !== "success") return [];
  const refs: Array<Record<string, unknown>> = [];
  for (const value of Object.values(result.data)) {
    collectOutputRefs(value, refs);
  }
  return refs;
}

function collectOutputRefs(value: unknown, refs: Array<Record<string, unknown>>) {
  if (!isRecord(value)) return;
  const filePath = typeof value.filePath === "string" ? value.filePath : typeof value.path === "string" ? value.path : null;
  if (filePath) {
    refs.push({
      name: filePath.split(/[\\/]/).pop() ?? filePath,
      path: filePath,
      type: "file",
      available: true
    });
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((item) => collectOutputRefs(item, refs));
    else if (isRecord(child)) collectOutputRefs(child, refs);
  }
}

function summaryValue(value: unknown) {
  if (Array.isArray(value)) return `${value.length} items`;
  if (isRecord(value)) {
    if (typeof value.filePath === "string") return `file: ${value.filePath}`;
    return `${Object.keys(value).length} fields`;
  }
  return String(value ?? "").slice(0, 200);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
