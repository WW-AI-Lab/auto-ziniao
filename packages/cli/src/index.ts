import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Command, CommanderError, Option } from "commander";

import { defaultRepoRoot, readJsonFile } from "@ziniao/core";
import {
  FlowDefinition,
  HealEventSchema,
  RunLogEntry,
  RunLogEntrySchema
} from "@ziniao/schemas";
import {
  FlowRunFailure,
  FlowRunResult,
  FlowToolClient,
  loadFlow,
  parseParams,
  runFlow,
  validateFlow
} from "@ziniao/flow-engine";
import {
  AgentRunner,
  buildTriggerInputFromFailure,
  HealConfig,
  triggerHeal
} from "@ziniao/self-heal";

export type TextSink = (text: string) => void;

export type CliClock = {
  now(): Date;
};

export type CliDependencies = {
  repoRoot?: string;
  dataRoot?: string;
  toolClient?: FlowToolClient;
  agentRunner?: AgentRunner;
  healConfig?: HealConfig;
  clock?: CliClock;
  sleeper?: (ms: number) => Promise<void>;
  stdout?: TextSink;
  stderr?: TextSink;
};

export type CliApp = {
  program: Command;
  getExitCode(): number;
};

type CliContext = {
  repoRoot: string;
  dataRoot: string;
  stdout: TextSink;
  stderr: TextSink;
};

type RunCommandOptions = {
  param?: string[];
  verbose?: boolean;
  heal?: boolean;
  noHeal?: boolean;
  healDryRun?: boolean;
};

type FlowListItem = {
  id: string;
  name: string;
  version?: number;
  enabled?: boolean;
  schedule?: string;
  params?: Record<string, unknown>;
  filePath: string;
};

const defaultStdout: TextSink = (text) => process.stdout.write(text);
const defaultStderr: TextSink = (text) => process.stderr.write(text);

export function createCliApp(deps: CliDependencies = {}): CliApp {
  const state = { exitCode: 0 };
  const stdout = deps.stdout ?? defaultStdout;
  const stderr = deps.stderr ?? defaultStderr;
  const program = new Command();

  program
    .name("ziniao")
    .description("紫鸟自动化引擎 CLI")
    .exitOverride()
    .configureOutput({
      writeOut: stdout,
      writeErr: stderr
    })
    .addOption(new Option("--repo-root <path>", "仓库根目录").hideHelp())
    .addOption(new Option("--data-root <path>", "运行数据目录").hideHelp())
    .showHelpAfterError();

  program
    .command("list")
    .description("列出所有流程及状态")
    .action(() => {
      state.exitCode = cmdList(resolveContext(program, deps));
    });

  program
    .command("validate")
    .description("静态校验流程定义")
    .argument("<flow_id>", "流程 ID")
    .action((flowId: string) => {
      state.exitCode = cmdValidate(flowId, resolveContext(program, deps));
    });

  program
    .command("new")
    .description("从模板创建新流程")
    .argument("<flow_id>", "流程 ID")
    .argument("[name]", "中文名称")
    .action((flowId: string, name: string | undefined) => {
      state.exitCode = cmdNew(flowId, name, resolveContext(program, deps));
    });

  program
    .command("enable")
    .description("启用流程")
    .argument("<flow_id>", "流程 ID")
    .action((flowId: string) => {
      state.exitCode = cmdSetEnabled(flowId, true, resolveContext(program, deps));
    });

  program
    .command("disable")
    .description("禁用流程")
    .argument("<flow_id>", "流程 ID")
    .action((flowId: string) => {
      state.exitCode = cmdSetEnabled(flowId, false, resolveContext(program, deps));
    });

  program
    .command("run")
    .description("执行指定流程")
    .argument("<flow_id>", "流程 ID")
    .option("-p, --param <pair>", "流程参数 key=value，可重复", collect, [])
    .option("-v, --verbose", "详细输出")
    .option("--no-heal", "失败时不触发自愈")
    .option("--heal-dry-run", "生成自愈上下文和提示词，但不调用真实 Agent CLI")
    .action(async (flowId: string, options: RunCommandOptions) => {
      state.exitCode = await executeFlow(flowId, options, resolveContext(program, deps), deps);
    });

  program
    .command("run-all")
    .description("执行所有已启用流程")
    .option("-v, --verbose", "详细输出")
    .option("--no-heal", "失败时不触发自愈")
    .option("--heal-dry-run", "生成自愈上下文和提示词，但不调用真实 Agent CLI")
    .action(async (options: RunCommandOptions) => {
      state.exitCode = await cmdRunAll(options, resolveContext(program, deps), deps);
    });

  program
    .command("retry")
    .description("重试上次失败的流程")
    .argument("<flow_id>", "流程 ID")
    .option("-v, --verbose", "详细输出")
    .option("--no-heal", "失败时不触发自愈")
    .option("--heal-dry-run", "生成自愈上下文和提示词，但不调用真实 Agent CLI")
    .action(async (flowId: string, options: RunCommandOptions) => {
      state.exitCode = await cmdRetry(flowId, options, resolveContext(program, deps), deps);
    });

  program
    .command("history")
    .description("查看运行历史")
    .argument("[flow_id]", "流程 ID")
    .action((flowId: string | undefined) => {
      state.exitCode = cmdHistory(flowId, resolveContext(program, deps));
    });

  program
    .command("heals")
    .description("查看自愈记录")
    .action(() => {
      state.exitCode = cmdHeals(resolveContext(program, deps));
    });

  program
    .command("stats")
    .description("运行统计")
    .action(() => {
      state.exitCode = cmdStats(resolveContext(program, deps));
    });

  program
    .command("cron")
    .description("显示 crontab 配置建议")
    .action(() => {
      state.exitCode = cmdCron(resolveContext(program, deps));
    });

  return {
    program,
    getExitCode: () => state.exitCode
  };
}

export async function runCli(
  argv: string[] = process.argv.slice(2),
  deps: CliDependencies = {}
): Promise<number> {
  const app = createCliApp(deps);
  try {
    await app.program.parseAsync(argv, { from: "user" });
    return app.getExitCode();
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }
    const message = error instanceof Error ? error.message : String(error);
    (deps.stderr ?? defaultStderr)(`错误: ${message}\n`);
    return 1;
  }
}

function resolveContext(command: Command, deps: CliDependencies): CliContext {
  const opts = command.opts<{
    repoRoot?: string;
    dataRoot?: string;
  }>();
  const repoRoot = path.resolve(opts.repoRoot ?? deps.repoRoot ?? defaultRepoRoot);
  const dataRoot = path.resolve(opts.dataRoot ?? deps.dataRoot ?? path.join(repoRoot, "data"));
  return {
    repoRoot,
    dataRoot,
    stdout: deps.stdout ?? defaultStdout,
    stderr: deps.stderr ?? defaultStderr
  };
}

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function cmdList(ctx: CliContext): number {
  const flows = listFlows(ctx.repoRoot);
  if (flows.length === 0) {
    ctx.stdout("没有找到任何流程。请在 flows/ 目录下创建 .json 文件。\n");
    return 0;
  }

  ctx.stdout("\nID\t名称\t版本\t状态\t调度\t上次运行\t结果\t参数\n");
  for (const flow of flows) {
    const last = showHistory(ctx.dataRoot, flow.id, 1).at(-1);
    const params = Object.entries(flow.params ?? {})
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(",");
    ctx.stdout(
      [
        flow.id,
        flow.name,
        `v${flow.version ?? 1}`,
        flow.enabled === false ? "disabled" : "enabled",
        flow.schedule || "-",
        last?.timestamp ?? "-",
        last?.status ?? "-",
        params || "-"
      ].join("\t") + "\n"
    );
  }
  ctx.stdout("\n");
  return 0;
}

function cmdValidate(flowId: string, ctx: CliContext): number {
  const filePath = flowFilePath(ctx.repoRoot, flowId);
  if (!existsSync(filePath)) {
    ctx.stderr(`流程不存在: ${flowId}\n`);
    return 1;
  }
  const result = validateFlow(readJsonFile(filePath), { repoRoot: ctx.repoRoot });
  if (result.issues.length === 0) {
    ctx.stdout(`${flowId} 校验通过\n`);
    return 0;
  }
  for (const issue of result.issues) {
    ctx.stdout(`[${issue.level}] ${issue.message}\n`);
  }
  return result.issues.some((issue) => issue.level === "error") ? 1 : 0;
}

function cmdNew(flowId: string, name: string | undefined, ctx: CliContext): number {
  const flowsDir = path.join(ctx.repoRoot, "flows");
  const flowPath = path.join(flowsDir, `${flowId}.json`);
  const templatePath = path.join(flowsDir, "_template.json");
  if (existsSync(flowPath)) {
    ctx.stderr(`流程已存在: ${flowPath}\n`);
    return 1;
  }
  if (!existsSync(templatePath)) {
    ctx.stderr(`模板不存在: ${templatePath}\n`);
    return 1;
  }
  mkdirSync(flowsDir, { recursive: true });
  const content = readFileSync(templatePath, "utf8")
    .replaceAll("__FLOW_ID__", flowId)
    .replaceAll("__FLOW_NAME__", name ?? flowId);
  writeFileSync(flowPath, content, "utf8");
  ctx.stdout(`已创建流程: ${flowPath}\n`);
  ctx.stdout(`下一步: ziniao validate ${flowId} && ziniao run ${flowId} -v --no-heal\n`);
  return 0;
}

function cmdSetEnabled(flowId: string, enabled: boolean, ctx: CliContext): number {
  const filePath = flowFilePath(ctx.repoRoot, flowId);
  if (!existsSync(filePath)) {
    ctx.stderr(`流程不存在: ${flowId}\n`);
    return 1;
  }
  const flow = readJsonFile<Record<string, unknown>>(filePath);
  flow.enabled = enabled;
  writeJsonFile(filePath, flow);
  ctx.stdout(`${enabled ? "已启用" : "已禁用"}: ${flowId}\n`);
  return 0;
}

async function executeFlow(
  flowId: string,
  options: RunCommandOptions,
  ctx: CliContext,
  deps: CliDependencies
): Promise<number> {
  let params: Record<string, string>;
  let flow: FlowDefinition;
  try {
    params = parseParams(options.param ?? []);
    flow = loadFlow(flowId, { repoRoot: ctx.repoRoot });
  } catch (error) {
    ctx.stderr(`${errorMessage(error)}\n`);
    return 1;
  }

  ctx.stdout(`\n执行流程: ${flow.name} (v${flow.version ?? 1})\n`);
  const result = await runFlow(flow, {
    repoRoot: ctx.repoRoot,
    dataRoot: ctx.dataRoot,
    params,
    toolClient: deps.toolClient,
    sleeper: deps.sleeper,
    clock: deps.clock,
    verbose: options.verbose,
    heal: !isNoHeal(options),
    logger: {
      log: (message?: unknown) => ctx.stdout(`${String(message ?? "")}\n`),
      error: (message?: unknown) => ctx.stderr(`${String(message ?? "")}\n`)
    }
  });

  if (result.status === "success") {
    ctx.stdout("执行成功\n");
    for (const [stepId, stepData] of Object.entries(result.data)) {
      ctx.stdout(`  [${stepId}] -> ${truncate(safeJson(stepData), 150)}\n`);
    }
    return 0;
  }

  ctx.stderr(`执行失败: ${result.error}\n`);
  if (result.failed_step) {
    ctx.stderr(`失败步骤: ${result.failed_step.step_id}\n`);
  }

  if (!isNoHeal(options) && shouldTriggerHeal(flow, result)) {
    const healResult = await triggerHeal(
      buildTriggerInputFromFailure({ flow, result, params }),
      {
        repoRoot: ctx.repoRoot,
        dataRoot: ctx.dataRoot,
        agentRunner: deps.agentRunner,
        config: deps.healConfig,
        clock: deps.clock,
        dryRun: options.healDryRun
      }
    );
    ctx.stderr(
      `自愈结果: heal_id=${healResult.heal_id} error_type=${healResult.error_type}` +
        ` prompt=${healResult.prompt_path} context=${healResult.heal_log_path}\n`
    );
    if (healResult.skipped) {
      ctx.stderr(`自愈跳过: ${healResult.reason ?? "unknown"}\n`);
    } else if (healResult.dry_run) {
      ctx.stderr("自愈 dry-run：未调用真实 Agent CLI\n");
    } else if (healResult.success === false) {
      ctx.stderr(`自愈失败: ${healResult.error ?? "Agent returned non-zero"}\n`);
    } else if (healResult.success) {
      ctx.stderr(`自愈已触发: agent=${healResult.agent ?? "-"}\n`);
    }
  }

  return 1;
}

async function cmdRunAll(
  options: RunCommandOptions,
  ctx: CliContext,
  deps: CliDependencies
): Promise<number> {
  const flows = listFlows(ctx.repoRoot).filter((flow) => flow.enabled !== false);
  if (flows.length === 0) {
    ctx.stdout("没有启用的流程\n");
    return 0;
  }
  let failed = 0;
  for (const flow of flows) {
    const code = await executeFlow(flow.id, { ...options, param: [] }, ctx, deps);
    if (code !== 0) {
      failed += 1;
    }
  }
  ctx.stdout("\n汇总:\n");
  ctx.stdout(`  success=${flows.length - failed} failed=${failed}\n`);
  return failed === 0 ? 0 : 1;
}

async function cmdRetry(
  flowId: string,
  options: RunCommandOptions,
  ctx: CliContext,
  deps: CliDependencies
): Promise<number> {
  const last = showHistory(ctx.dataRoot, flowId, 1).at(-1);
  if (!last) {
    ctx.stdout(`没有 ${flowId} 的运行记录\n`);
    return 0;
  }
  if (last.status === "success") {
    ctx.stdout("上次运行已成功，无需重试\n");
    return 0;
  }
  const params = Object.entries(last.params ?? {}).map(([key, value]) => `${key}=${value}`);
  ctx.stdout(`上次运行失败于 ${last.timestamp}，重新执行\n`);
  return executeFlow(flowId, { ...options, param: params }, ctx, deps);
}

function cmdHistory(flowId: string | undefined, ctx: CliContext): number {
  const entries = showHistory(ctx.dataRoot, flowId, 15);
  if (entries.length === 0) {
    ctx.stdout("没有运行记录\n");
    return 0;
  }
  ctx.stdout("\n时间\t流程\t状态\t耗时\t错误\n");
  for (const entry of entries) {
    ctx.stdout(
      [
        entry.timestamp,
        entry.flow_id,
        entry.status,
        entry.duration_ms === undefined ? "-" : `${entry.duration_ms}ms`,
        truncate(entry.error ?? "", 50)
      ].join("\t") + "\n"
    );
  }
  ctx.stdout("\n");
  return 0;
}

function cmdHeals(ctx: CliContext): number {
  const entries = readJsonLines(path.join(ctx.repoRoot, "learnings", "heals.jsonl"), (row) =>
    HealEventSchema.parse(row)
  );
  if (entries.length === 0) {
    ctx.stdout("没有自愈记录\n");
    return 0;
  }
  ctx.stdout("\n时间\t事件\t流程\t步骤\t类型/原因\n");
  for (const entry of entries.slice(-20)) {
    ctx.stdout(
      [
        entry.timestamp ?? "",
        entry.event ?? "?",
        entry.flow_id ?? "?",
        entry.step_id ?? "?",
        entry.error_type ?? entry.reason ?? ""
      ].join("\t") + "\n"
    );
  }
  ctx.stdout("\n");
  return 0;
}

function cmdStats(ctx: CliContext): number {
  const entries = showHistory(ctx.dataRoot, undefined, 1000);
  if (entries.length === 0) {
    ctx.stdout("没有运行记录\n");
    return 0;
  }
  const total = entries.length;
  const success = entries.filter((entry) => entry.status === "success").length;
  const failed = entries.filter((entry) => entry.status === "failed").length;
  const errors = entries.filter((entry) => entry.status === "error").length;
  ctx.stdout(`\n运行统计 (最近 ${total} 次)\n`);
  ctx.stdout(`  成功: ${success} (${Math.round((success / total) * 100)}%)\n`);
  ctx.stdout(`  失败: ${failed}\n`);
  ctx.stdout(`  异常: ${errors}\n`);

  const byFlow = new Map<string, { total: number; success: number }>();
  for (const entry of entries) {
    const item = byFlow.get(entry.flow_id) ?? { total: 0, success: 0 };
    item.total += 1;
    if (entry.status === "success") {
      item.success += 1;
    }
    byFlow.set(entry.flow_id, item);
  }
  ctx.stdout("\n按流程:\n");
  for (const [flowId, item] of [...byFlow.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    ctx.stdout(`  ${flowId}: ${item.success}/${item.total} (${Math.round((item.success / item.total) * 100)}%)\n`);
  }
  ctx.stdout("\n");
  return 0;
}

function cmdCron(ctx: CliContext): number {
  const flows = listFlows(ctx.repoRoot).filter((flow) => flow.enabled !== false && flow.schedule);
  if (flows.length === 0) {
    ctx.stdout("没有配置了调度计划的流程\n");
    return 0;
  }
  ctx.stdout("\n建议的 crontab 配置:\n\n");
  for (const flow of flows) {
    ctx.stdout(
      `${flow.schedule}  cd ${ctx.repoRoot} && pnpm ziniao run ${flow.id} >> data/logs/cron_${flow.id}.log 2>&1\n`
    );
  }
  ctx.stdout("\n");
  return 0;
}

function listFlows(repoRoot: string): FlowListItem[] {
  const flowsDir = path.join(repoRoot, "flows");
  if (!existsSync(flowsDir)) {
    return [];
  }
  return readdirSync(flowsDir)
    .filter((name) => name.endsWith(".json") && !name.startsWith("_"))
    .sort((a, b) => a.localeCompare(b))
    .flatMap((name) => {
      const filePath = path.join(flowsDir, name);
      try {
        const parsed = loadFlow(filePath, { repoRoot });
        return [{ ...parsed, filePath }];
      } catch {
        const raw = readJsonFile<Record<string, unknown>>(filePath);
        return [{
          id: String(raw.id ?? path.basename(name, ".json")),
          name: String(raw.name ?? raw.id ?? path.basename(name, ".json")),
          version: typeof raw.version === "number" ? raw.version : 1,
          enabled: raw.enabled as boolean | undefined,
          schedule: typeof raw.schedule === "string" ? raw.schedule : "",
          params: isRecord(raw.params) ? raw.params : {},
          filePath
        }];
      }
    });
}

function showHistory(dataRoot: string, flowId: string | undefined, last: number): RunLogEntry[] {
  const rows = readJsonLines(path.join(dataRoot, "logs", "runs.jsonl"), (row) =>
    RunLogEntrySchema.parse(row)
  );
  const filtered = flowId ? rows.filter((row) => row.flow_id === flowId) : rows;
  return filtered.slice(-last);
}

function readJsonLines<T>(filePath: string, parse: (row: unknown) => T): T[] {
  if (!existsSync(filePath)) {
    return [];
  }
  const out: T[] = [];
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const text = line.trim();
    if (!text) {
      continue;
    }
    try {
      out.push(parse(JSON.parse(text)));
    } catch {
      continue;
    }
  }
  return out;
}

function shouldTriggerHeal(flow: FlowDefinition, result: FlowRunFailure): boolean {
  if (flow.on_fail_final?.heal === false) {
    return false;
  }
  const reason = isRecord(result.heal) ? result.heal.reason : undefined;
  return reason !== "validation_failed" && reason !== "disabled_by_flow";
}

function isNoHeal(options: RunCommandOptions): boolean {
  return options.noHeal === true || options.heal === false;
}

function flowFilePath(repoRoot: string, flowId: string): string {
  return path.join(repoRoot, "flows", `${flowId}.json`);
}

function writeJsonFile(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 0);
  } catch {
    return String(value);
  }
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : value.slice(0, length);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
