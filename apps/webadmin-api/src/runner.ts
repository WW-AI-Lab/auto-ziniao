import { runFlow, FlowToolClient, FlowRunResult } from "@ziniao/flow-engine";

export type Clock = { now(): Date };

export type RunEntry = {
  token: string;
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
};

export type FlowRunnerDeps = {
  repoRoot: string;
  dataRoot: string;
  toolClient?: FlowToolClient;
  sleeper?: (ms: number) => Promise<void>;
  clock?: Clock;
  timeoutMs?: number;
};

export function createFlowRunner(deps: FlowRunnerDeps) {
  const running = new Set<string>();
  const runs = new Map<string, RunEntry>();
  const clock = deps.clock ?? { now: () => new Date() };

  async function execute(flowId: string, params: Record<string, string> = {}) {
    if (running.has(flowId)) {
      return {
        status: "skipped",
        error: `flow ${flowId} 已有运行中实例`,
        exit_code: null,
        duration_ms: 0
      };
    }
    running.add(flowId);
    const started = Date.now();
    try {
      const result = await runFlow(flowId, {
        repoRoot: deps.repoRoot,
        dataRoot: deps.dataRoot,
        params,
        toolClient: deps.toolClient,
        sleeper: deps.sleeper,
        heal: false
      });
      const failed = result.status !== "success";
      return {
        status: failed ? result.status : "success",
        error: failed ? result.error : null,
        exit_code: failed ? 1 : 0,
        duration_ms: Date.now() - started,
        result
      };
    } catch (error) {
      return {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        exit_code: 1,
        duration_ms: Date.now() - started
      };
    } finally {
      running.delete(flowId);
    }
  }

  return {
    isRunning: (flowId: string) => running.has(flowId),
    runs,
    async execute(flowId: string, params: Record<string, string> = {}) {
      return execute(flowId, params);
    },
    start(flowId: string, params: Record<string, string> = {}) {
      if (running.has(flowId)) {
        throw new Error(`flow ${flowId} 已有运行中实例`);
      }
      const token = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
      const entry: RunEntry = {
        token,
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
      void execute(flowId, params).then((result) => {
        Object.assign(entry, {
          status: result.status,
          finished_at: clock.now().toISOString(),
          exit_code: result.exit_code,
          duration_ms: result.duration_ms,
          error: result.error ?? null,
          result: result.result
        });
      });
      return { token, flow_id: flowId, status: "running" };
    },
    get(token: string) {
      return runs.get(token) ?? null;
    }
  };
}
