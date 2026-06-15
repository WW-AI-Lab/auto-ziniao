import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

import {
  appendJsonLine,
  defaultRepoRoot,
  readJsonFile,
  readJsonLinesFile,
  writeJsonFileAsync,
  writeTextFile,
  ZiniaoError
} from "@ziniao/core";
import {
  FlowDefinition,
  HealContextSchema,
  HealEventSchema,
  KnownIssue,
  KnownIssuesFileSchema
} from "@ziniao/schemas";

export type HealErrorType =
  | "auth_failed"
  | "timeout"
  | "element_not_found"
  | "nav_failed"
  | "extract_failed"
  | "bridge_down"
  | "generic";

export type Clock = {
  now(): Date;
};

export type FailedStepInput = {
  step_id?: string;
  tool?: string;
  action?: string;
  args?: unknown;
  heal_context?: string;
  error?: string;
};

export type HealTriggerInput = {
  flow_id: string;
  flow_name?: string;
  step_id?: string;
  tool_name?: string;
  action?: string;
  error: string;
  params?: Record<string, unknown>;
  failed_step?: FailedStepInput;
  heal_context?: string;
  heal_section?: FlowDefinition["heal"];
  screenshot?: string;
  store_id?: string;
  target_id?: string;
  heal_id?: string;
};

export type HealConfig = {
  heal: {
    enabled: boolean;
    agent: string;
    cooldown_minutes: number;
    max_per_day: number;
    agents: Record<string, AgentConfig>;
  };
  notify?: Record<string, unknown>;
};

export type AgentConfig = {
  command: string[];
  timeout_sec?: number;
};

export type AgentRunInput = {
  command: string[];
  timeoutMs: number;
};

export type AgentRunResult = {
  exitCode: number;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  commandMissing?: boolean;
};

export type AgentRunner = {
  run(input: AgentRunInput): Promise<AgentRunResult>;
};

export type SelfHealOptions = {
  repoRoot?: string;
  dataRoot?: string;
  clock?: Clock;
  config?: HealConfig;
  agentRunner?: AgentRunner;
  agent?: string;
  dryRun?: boolean;
};

export type BuildPromptResult = {
  heal_id: string;
  error_type: HealErrorType;
  prompt: string;
  prompt_path: string;
  heal_log_path: string;
};

export type TriggerHealResult = {
  heal_id: string;
  error_type: HealErrorType;
  status?: "triggered" | "skipped" | "success" | "failed" | "timeout" | "dry_run" | "disabled";
  prompt_path: string;
  heal_log_path: string;
  dry_run?: boolean;
  skipped?: boolean;
  reason?: string;
  success?: boolean;
  agent?: string;
  known_issue?: KnownIssue;
  error?: string;
};

type RenderFields = Record<string, string>;

const defaultClock: Clock = { now: () => new Date() };

export const DEFAULT_HEAL_CONFIG: HealConfig = {
  heal: {
    enabled: true,
    agent: "openclaw",
    cooldown_minutes: 60,
    max_per_day: 5,
    agents: {
      openclaw: {
        command: [
          "openclaw",
          "agent",
          "--session-key",
          "{session_key}",
          "--message",
          "{prompt}",
          "--deliver",
          "--channel",
          "feishu",
          "--timeout",
          "300"
        ],
        timeout_sec: 320
      },
      claude: {
        command: ["claude", "-p", "{prompt}", "--allowedTools", "Bash,Read,Write,Edit"],
        timeout_sec: 600
      },
      "cursor-agent": {
        command: ["cursor-agent", "-p", "{prompt}"],
        timeout_sec: 600
      }
    }
  },
  notify: { channel: "feishu" }
};

const validErrorTypes = new Set<HealErrorType>([
  "auth_failed",
  "timeout",
  "element_not_found",
  "nav_failed",
  "extract_failed",
  "bridge_down",
  "generic"
]);

const builtinTemplates: Record<HealErrorType, string> = {
  nav_failed:
    "## 诊断方向（导航失败）\n1. 打开对应店铺环境并访问目标页面，确认跳转、404 或登录态。\n2. 截图确认页面实际状态。\n3. 如入口变化，修复 flows/{flow_id}.json 中的 URL 或导航方式。\n",
  extract_failed:
    "## 诊断方向（数据提取失败）\n1. 打开目标页面并检查实际 DOM 结构。\n2. 对比 extracts/ 中的提取 JS 与实际页面差异。\n3. 修复选择器或解析逻辑，重跑流程验证结果非空。\n",
  element_not_found:
    "## 诊断方向（元素未找到 / 校验失败）\n1. 确认页面是否改版、加载慢或出现弹窗遮罩。\n2. 尝试候选选择器或可见文本定位。\n3. 修复流程中的 selector、hint 或提取脚本。\n",
  timeout:
    "## 诊断方向（超时）\n1. 观察页面加载耗时和目标入口是否有效。\n2. 偶发网络慢可调大 timeoutMs 或增加 on_fail.retry。\n3. 持续超时应检查目标页面和店铺环境状态。\n",
  auth_failed:
    "## 诊断方向（认证失败）\n1. 检查本地客户端认证配置是否有效。\n2. 站点登录态过期时，通知用户手动登录后重试。\n3. 认证问题通常不应通过修改流程定义掩盖。\n",
  bridge_down:
    "## 诊断方向（bridge 不可达）\n1. 确认紫鸟客户端是否在运行。\n2. bridge 不可达属于环境问题，不要修改流程定义。\n3. 通知用户启动客户端后重试。\n",
  generic:
    "## 诊断方向（通用）\n1. 读取 flows/{flow_id}.json 理解流程，定位失败步骤 {step_id}。\n2. 复现失败步骤并观察实际返回。\n3. 根据根因调整流程定义或提取脚本，重跑验证。\n"
};

export class SelfHealError extends ZiniaoError {
  constructor(message: string, code = "self_heal_error", details?: unknown) {
    super(message, code, details);
    this.name = "SelfHealError";
  }
}

export function classifyError(input: {
  error?: unknown;
  stepId?: string;
  toolName?: string;
  healContext?: string;
}): HealErrorType {
  if (input.healContext && validErrorTypes.has(input.healContext as HealErrorType)) {
    return input.healContext as HealErrorType;
  }

  const errorLower = String(input.error ?? "").toLowerCase();
  const stepId = input.stepId ?? "";
  const toolName = input.toolName ?? "";

  if (
    ["401", "403", "api key", "auth", "unauthorized", "missing bearer"].some((key) =>
      errorLower.includes(key)
    )
  ) {
    return "auth_failed";
  }
  if (["timeout", "timed out", "超时"].some((key) => errorLower.includes(key))) {
    return "timeout";
  }
  if (["连接失败", "connection refused", "bridge"].some((key) => errorLower.includes(key))) {
    return "bridge_down";
  }
  if (
    ["not found", "no element", "selector", "hint", "未找到", "校验失败", "行数不足", "结果为空"].some(
      (key) => errorLower.includes(key)
    )
  ) {
    return "element_not_found";
  }
  if (toolName === "visit_page" || stepId.includes("nav")) {
    return "nav_failed";
  }
  if (toolName === "execute_script" || stepId.includes("extract")) {
    return "extract_failed";
  }
  return "generic";
}

export function loadHealConfig(options: { repoRoot?: string } = {}): HealConfig {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const configPath = path.join(repoRoot, "config.json");
  const config = structuredClone(DEFAULT_HEAL_CONFIG);
  if (!existsSync(configPath)) {
    return config;
  }

  const userConfig = readJsonFile<Record<string, unknown>>(configPath);
  for (const [key, value] of Object.entries(userConfig)) {
    const current = (config as unknown as Record<string, unknown>)[key];
    if (isRecord(value) && isRecord(current)) {
      for (const [childKey, childValue] of Object.entries(value)) {
        if (key === "heal" && childKey === "agents" && isRecord(childValue)) {
          const heal = config.heal;
          heal.agents = { ...heal.agents, ...(childValue as Record<string, AgentConfig>) };
        } else {
          (current as Record<string, unknown>)[childKey] = childValue;
        }
      }
    } else {
      (config as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return config;
}

export function checkKnownIssues(
  input: { flowId: string; stepId?: string; error: unknown },
  options: { repoRoot?: string } = {}
): KnownIssue | undefined {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const knownPath = path.join(repoRoot, "learnings/known_issues.json");
  if (!existsSync(knownPath)) {
    return undefined;
  }
  const parsed = KnownIssuesFileSchema.parse(readJsonFile(knownPath));
  const error = String(input.error ?? "");
  for (const issue of parsed.issues) {
    if (!issue.resolved) {
      continue;
    }
    const pattern = issue.pattern ?? "";
    const sameStep = issue.flow_id === input.flowId && issue.step_id === input.stepId;
    if ((pattern && error.includes(pattern)) || sameStep) {
      return issue;
    }
  }
  return undefined;
}

export async function buildHealPrompt(
  input: HealTriggerInput,
  options: SelfHealOptions = {}
): Promise<BuildPromptResult> {
  const clock = options.clock ?? defaultClock;
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const dataRoot = options.dataRoot ?? path.join(repoRoot, "data");
  const healId = input.heal_id ?? `heal_${input.flow_id}_${Math.floor(clock.now().getTime() / 1000)}`;
  const failedStep = input.failed_step;
  const stepId = input.step_id ?? failedStep?.step_id ?? "unknown";
  const toolName = input.tool_name ?? failedStep?.tool ?? input.action ?? failedStep?.action ?? "unknown";
  const healContext = input.heal_context ?? failedStep?.heal_context;
  const errorType = classifyError({
    error: input.error,
    stepId,
    toolName,
    healContext
  });
  const healLogPath = path.join(dataRoot, "logs/heals", `${healId}.json`);
  const promptPath = path.join(dataRoot, "logs/heals", `${healId}_prompt.md`);

  const contextData = {
    heal_id: healId,
    flow_id: input.flow_id,
    flow_name: input.flow_name ?? input.flow_id,
    step_id: stepId,
    tool_name: toolName,
    error_type: errorType,
    error: String(input.error),
    timestamp: clock.now().toISOString(),
    params: input.params ?? {},
    context: {
      failed_step: failedStep,
      store_id: input.store_id,
      target_id: input.target_id
    },
    prompt_path: promptPath,
    failed_args: failedStep?.args ?? {},
    screenshot: input.screenshot
  };
  HealContextSchema.parse(contextData);
  await writeJsonFileAsync(healLogPath, contextData);

  const fields = makeRenderFields({
    repoRoot,
    input,
    healId,
    stepId,
    toolName,
    errorType,
    healLogPath,
    failedArgs: failedStep?.args ?? {},
    clock
  });
  const template = loadTemplate(repoRoot, input.flow_id, errorType);
  const prompt = [
    renderTemplate(buildPromptPrefix(), fields),
    renderTemplate(template, fields),
    buildHintsSection(input.heal_section),
    buildHistorySection(repoRoot, input.flow_id),
    renderTemplate(buildPromptFooter(), fields)
  ]
    .filter(Boolean)
    .join("\n");

  await writeTextFile(promptPath, prompt);
  return {
    heal_id: healId,
    error_type: errorType,
    prompt,
    prompt_path: promptPath,
    heal_log_path: healLogPath
  };
}

export async function checkCooldown(
  input: { flowId: string; stepId?: string; config: HealConfig },
  options: { repoRoot?: string; clock?: Clock } = {}
): Promise<string | undefined> {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const clock = options.clock ?? defaultClock;
  const events = await recentHealEvents(repoRoot);
  const triggers = events.filter((event) => event.event === "triggered");
  const now = clock.now();
  const todayText = formatDate(now);
  const today = triggers.filter(
    (event) => event.flow_id === input.flowId && String(event.timestamp ?? "").slice(0, 10) === todayText
  );
  const maxPerDay = input.config.heal.max_per_day;
  if (today.length >= maxPerDay) {
    return `流程 ${input.flowId} 今日自愈已达上限 ${maxPerDay} 次`;
  }

  const cooldownMs = input.config.heal.cooldown_minutes * 60 * 1000;
  const threshold = now.getTime() - cooldownMs;
  for (const event of [...triggers].reverse()) {
    if (event.flow_id !== input.flowId || event.step_id !== input.stepId) {
      continue;
    }
    const timestamp = Date.parse(String(event.timestamp ?? ""));
    if (!Number.isNaN(timestamp) && timestamp > threshold) {
      return `同一步骤 ${input.stepId ?? "unknown"} 在冷却期内（${input.config.heal.cooldown_minutes} 分钟）已触发过自愈，上次: ${event.timestamp}`;
    }
    break;
  }
  return undefined;
}

export async function triggerHeal(
  input: HealTriggerInput,
  options: SelfHealOptions = {}
): Promise<TriggerHealResult> {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const clock = options.clock ?? defaultClock;
  const config = options.config ?? loadHealConfig({ repoRoot });
  const promptResult = await buildHealPrompt(input, options);
  const stepId = input.step_id ?? input.failed_step?.step_id ?? "unknown";
  const base = {
    heal_id: promptResult.heal_id,
    error_type: promptResult.error_type,
    prompt_path: promptResult.prompt_path,
    heal_log_path: promptResult.heal_log_path
  };

  if (!config.heal.enabled) {
    await logHealEvent(repoRoot, {
      event: "skipped",
      reason: "config.heal.enabled = false",
      flow_id: input.flow_id,
      step_id: stepId,
      heal_id: promptResult.heal_id,
      error_type: promptResult.error_type,
      status: "disabled",
      timestamp: clock.now().toISOString()
    });
    return { ...base, status: "disabled", skipped: true, reason: "config.heal.enabled = false" };
  }

  if (options.dryRun) {
    return { ...base, status: "dry_run", dry_run: true };
  }

  const knownIssue = checkKnownIssues(
    { flowId: input.flow_id, stepId, error: input.error },
    { repoRoot }
  );
  if (knownIssue) {
    const reason = "known_issue_matched";
    await logHealEvent(repoRoot, {
      event: "skipped",
      reason,
      flow_id: input.flow_id,
      step_id: stepId,
      heal_id: promptResult.heal_id,
      error_type: promptResult.error_type,
      status: "skipped",
      timestamp: clock.now().toISOString()
    });
    return { ...base, status: "skipped", skipped: true, reason, known_issue: knownIssue };
  }

  const cooldownReason = await checkCooldown(
    { flowId: input.flow_id, stepId, config },
    { repoRoot, clock }
  );
  if (cooldownReason) {
    await logHealEvent(repoRoot, {
      event: "skipped",
      reason: cooldownReason,
      flow_id: input.flow_id,
      step_id: stepId,
      heal_id: promptResult.heal_id,
      error_type: promptResult.error_type,
      status: "skipped",
      timestamp: clock.now().toISOString()
    });
    return { ...base, status: "skipped", skipped: true, reason: cooldownReason };
  }

  const agentName = options.agent ?? config.heal.agent;
  const agentConfig = config.heal.agents[agentName];
  if (!agentConfig) {
    const message = `config.json 中未配置 agent: ${agentName}`;
    await logHealEvent(repoRoot, {
      event: "failed",
      reason: "agent_missing",
      flow_id: input.flow_id,
      step_id: stepId,
      heal_id: promptResult.heal_id,
      error_type: promptResult.error_type,
      status: "failed",
      timestamp: clock.now().toISOString()
    });
    return { ...base, status: "failed", success: false, error: message };
  }

  const placeholders = {
    prompt: promptResult.prompt,
    prompt_path: promptResult.prompt_path,
    session_key: `ziniao-heal:${input.flow_id}`,
    flow_id: input.flow_id,
    heal_id: promptResult.heal_id
  };
  const command = agentConfig.command.map((part) => renderTemplate(part, placeholders));
  const runner = options.agentRunner ?? createCommandAgentRunner();
  const result = await runner.run({
    command,
    timeoutMs: (agentConfig.timeout_sec ?? 600) * 1000
  });
  const event = {
    event: "triggered",
    heal_id: promptResult.heal_id,
    flow_id: input.flow_id,
    step_id: stepId,
    error_type: promptResult.error_type,
    agent: agentName,
    session_key: placeholders.session_key,
    prompt_path: promptResult.prompt_path,
    heal_log_path: promptResult.heal_log_path,
    status: result.timedOut ? "timeout" : result.exitCode === 0 ? "success" : "failed",
    timestamp: clock.now().toISOString(),
    cli_exit_code: result.exitCode,
    cli_stderr: (result.stderr ?? "").slice(0, 500)
  };
  await logHealEvent(repoRoot, event);

  if (result.timedOut) {
    return { ...base, status: "timeout", success: false, agent: agentName, error: "CLI timeout" };
  }
  if (result.commandMissing) {
    return { ...base, status: "failed", success: false, agent: agentName, error: `${command[0]} not found` };
  }
  return { ...base, status: result.exitCode === 0 ? "success" : "failed", success: result.exitCode === 0, agent: agentName };
}

export function createCommandAgentRunner(): AgentRunner {
  return {
    run({ command, timeoutMs }) {
      return new Promise<AgentRunResult>((resolve) => {
        if (command.length === 0) {
          resolve({ exitCode: 127, stderr: "empty command", commandMissing: true });
          return;
        }

        const child = spawn(command[0]!, command.slice(1), {
          stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          child.kill("SIGTERM");
          resolve({ exitCode: -1, stdout, stderr: `timeout after ${timeoutMs}ms`, timedOut: true });
        }, timeoutMs);

        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", (chunk) => {
          stdout += String(chunk);
        });
        child.stderr?.on("data", (chunk) => {
          stderr += String(chunk);
        });
        child.on("error", (error: NodeJS.ErrnoException) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve({
            exitCode: error.code === "ENOENT" ? 127 : 1,
            stdout,
            stderr: error.message,
            commandMissing: error.code === "ENOENT"
          });
        });
        child.on("close", (code) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve({ exitCode: code ?? 0, stdout, stderr });
        });
      });
    }
  };
}

export function buildTriggerInputFromFailure(input: {
  flow: Pick<FlowDefinition, "id" | "name" | "heal">;
  result: {
    status?: string;
    error?: string;
    failed_step?: FailedStepInput;
    heal?: Record<string, unknown>;
  };
  params?: Record<string, unknown>;
}): HealTriggerInput {
  const failedStep = input.result.failed_step;
  const heal = input.result.heal ?? {};
  return {
    flow_id: input.flow.id,
    flow_name: input.flow.name,
    step_id: failedStep?.step_id ?? "unknown",
    tool_name: failedStep?.tool ?? failedStep?.action ?? "unknown",
    action: failedStep?.action,
    error: input.result.error ?? failedStep?.error ?? "unknown error",
    params: input.params ?? {},
    failed_step: failedStep,
    heal_context: failedStep?.heal_context,
    heal_section: input.flow.heal,
    store_id: asString(heal.store_id),
    target_id: asString(heal.target_id)
  };
}

export function renderTemplate(template: string, fields: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => fields[key] ?? match);
}

async function recentHealEvents(repoRoot: string) {
  const eventsPath = path.join(repoRoot, "learnings/heals.jsonl");
  const rows = await readJsonLinesFile(eventsPath);
  return rows.map((row) => HealEventSchema.parse(row));
}

async function logHealEvent(repoRoot: string, event: Record<string, unknown>): Promise<void> {
  const parsed = HealEventSchema.parse(event);
  await appendJsonLine(path.join(repoRoot, "learnings/heals.jsonl"), parsed);
}

function loadTemplate(repoRoot: string, flowId: string, errorType: HealErrorType): string {
  const candidates = [
    path.join(repoRoot, "heal_templates", flowId, `${errorType}.md`),
    path.join(repoRoot, "heal_templates", flowId, "generic.md"),
    path.join(repoRoot, "heal_templates", `${errorType}.md`),
    path.join(repoRoot, "heal_templates/generic.md")
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        return readFileSync(candidate, "utf8");
      } catch {
        continue;
      }
    }
  }
  return builtinTemplates[errorType] ?? builtinTemplates.generic;
}

function buildPromptPrefix(): string {
  return [
    "你是紫鸟自动化自愈 Agent。一个固化的自动化流程执行失败了，需要你诊断并修复。",
    "",
    "## 你的任务",
    "1. 读取下方失败上下文和流程定义，理解问题",
    "2. 只能通过紫鸟店铺浏览器环境诊断，不得改用本机浏览器",
    "3. 找到根因：页面结构变化、选择器失效、超时、认证过期或环境问题",
    "4. 修复流程定义 JSON 或 extracts/ 下的提取脚本",
    "5. 重新执行修复后的流程验证：cd {scripts_dir} && pnpm ziniao run {flow_id} -v --no-heal",
    "6. 将修复方案写入 {scripts_dir}/learnings/known_issues.json",
    "",
    "## 失败上下文",
    "- 流程: {flow_name} ({flow_id}) 版本文件: {scripts_dir}/flows/{flow_id}.json",
    "- 失败步骤: {step_id}（工具: {tool_name}）",
    "- 错误类型: {error_type}",
    "- 错误信息: {error}",
    "- 失败时间: {timestamp}",
    "- 运行参数: {params}",
    "- 失败步骤入参: {failed_args}",
    "- 失败现场截图: {screenshot}",
    "- 自愈上下文文件: {heal_log_path}"
  ].join("\n");
}

function buildPromptFooter(): string {
  return [
    "## 修复后必须执行（固化闭环）",
    "1. 更新 {scripts_dir}/flows/{flow_id}.json 或对应的 extracts/*.js（修复根因，版本号 version +1）",
    "2. 校验: pnpm ziniao validate {flow_id}",
    "3. 验证: pnpm ziniao run {flow_id} -v --no-heal（必须真实跑通）",
    "4. 将修复写入 {scripts_dir}/learnings/known_issues.json 的 issues 数组",
    "5. 通知用户：修复了什么、根因、验证结果"
  ].join("\n");
}

function makeRenderFields(input: {
  repoRoot: string;
  input: HealTriggerInput;
  healId: string;
  stepId: string;
  toolName: string;
  errorType: HealErrorType;
  healLogPath: string;
  failedArgs: unknown;
  clock: Clock;
}): RenderFields {
  return {
    scripts_dir: input.repoRoot,
    flow_id: input.input.flow_id,
    flow_name: input.input.flow_name ?? input.input.flow_id,
    step_id: input.stepId,
    tool_name: input.toolName,
    error_type: input.errorType,
    error: String(input.input.error).slice(0, 800),
    timestamp: formatDateTime(input.clock.now()),
    heal_log_path: input.healLogPath,
    params: JSON.stringify(input.input.params ?? {}),
    failed_args: JSON.stringify(input.failedArgs).slice(0, 500),
    screenshot: input.input.screenshot ?? "（无）",
    heal_id: input.healId
  };
}

function buildHintsSection(healSection: FlowDefinition["heal"] | undefined): string {
  if (!healSection?.hints) {
    return "";
  }
  return `## 本流程的自愈提示（沉淀时编写）\n${healSection.hints}\n`;
}

function buildHistorySection(repoRoot: string, flowId: string): string {
  const knownPath = path.join(repoRoot, "learnings/known_issues.json");
  if (!existsSync(knownPath)) {
    return "";
  }
  try {
    const known = KnownIssuesFileSchema.parse(readJsonFile(knownPath));
    const related = known.issues.filter((issue) => issue.flow_id === flowId).slice(-5);
    if (related.length === 0) {
      return "";
    }
    return [
      "## 历史修复记录（避免重复修复）",
      ...related.map(
        (issue) =>
          `- 问题: ${String(issue.pattern ?? "").slice(0, 80)}\n  根因: ${String(issue.root_cause ?? "").slice(0, 80)}\n  修复: ${String(issue.fix ?? "").slice(0, 80)}\n  状态: ${issue.resolved ? "已解决" : "未解决"}`
      )
    ].join("\n");
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai"
  })
    .format(date)
    .replace(/\//g, "-");
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
