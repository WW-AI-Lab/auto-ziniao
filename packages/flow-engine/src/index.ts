import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { defaultRepoRoot, readJsonFile, ZiniaoError } from "@ziniao/core";
import {
  FlowDefinition,
  FlowStep,
  FlowValidationResult,
  KNOWN_ZCLAW_TOOL_SET,
  KnownZclawTool,
  RunLogEntrySchema,
  ValidationIssue,
  validateFlowContract
} from "@ziniao/schemas";
import {
  createZClawClient,
  InvokeArgs,
  ZClawClient,
  ZClawClientOptions
} from "@ziniao/zclaw";

export class FlowEngineError extends ZiniaoError {
  constructor(message: string, code = "flow_engine_error", details?: unknown) {
    super(message, code, details);
    this.name = "FlowEngineError";
  }
}

export class FlowValidationError extends FlowEngineError {
  constructor(message: string, details?: unknown) {
    super(message, "flow_validation_error", details);
    this.name = "FlowValidationError";
  }
}

export type FlowToolClient = {
  storeId?: string;
  targetId?: string;
  invoke(tool: string, args?: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  listStores?(): Promise<unknown[]>;
  openStore?(input?: {
    storeId?: string;
    storeName?: string;
    launchUrl?: string;
  }): Promise<Record<string, unknown>>;
  visit?(
    url: string,
    options?: { waitUntil?: string; timeoutMs?: number }
  ): Promise<unknown>;
  executeScript?<T = unknown>(
    script: string,
    returnByValue?: boolean
  ): Promise<T | string>;
  click?(input?: {
    selector?: string;
    hint?: string;
    waitForNavigation?: boolean;
    timeoutMs?: number;
  }): Promise<unknown>;
  screenshot?(options?: {
    fullPage?: boolean;
    format?: "png" | "jpeg";
  }): Promise<string>;
  waitElement?(
    selector: string,
    options?: { timeoutMs?: number; state?: string }
  ): Promise<unknown>;
  closeStore?(storeId?: string): Promise<unknown>;
};

export type Clock = {
  now(): Date;
};

export type FlowRunnerOptions = {
  repoRoot?: string;
  dataRoot?: string;
  toolClient?: FlowToolClient;
  zclawOptions?: ZClawClientOptions;
  sleeper?: (ms: number) => Promise<void>;
  clock?: Clock;
  logger?: Pick<Console, "log" | "error">;
  verbose?: boolean;
  heal?: boolean;
  maxExecutions?: number;
};

export type RunFlowOptions = FlowRunnerOptions & {
  params?: Record<string, unknown>;
  sourceFile?: string;
};

export type FailedStep = {
  step_id: string;
  tool?: string;
  action?: string;
  args: unknown;
  heal_context?: string;
  error: string;
};

export type FlowRunSuccess = {
  status: "success";
  data: Record<string, unknown>;
};

export type FlowRunFailure = {
  status: "failed" | "error" | "exhausted";
  error: string;
  failed_step?: FailedStep;
  heal?: Record<string, unknown>;
};

export type FlowRunResult = FlowRunSuccess | FlowRunFailure;

type StepControl =
  | { kind: "next"; result?: unknown }
  | { kind: "jump"; target: string; result?: unknown }
  | { kind: "end"; result?: unknown };

const defaultSleeper = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export function createZClawFlowToolClient(
  clientOrOptions: ZClawClient | ZClawClientOptions = {}
): FlowToolClient {
  const client =
    clientOrOptions instanceof ZClawClient
      ? clientOrOptions
      : createZClawClient(clientOrOptions);
  return {
    get storeId() {
      return client.storeId;
    },
    set storeId(value: string | undefined) {
      client.storeId = value;
    },
    get targetId() {
      return client.targetId;
    },
    set targetId(value: string | undefined) {
      client.targetId = value;
    },
    invoke(tool, args = {}, timeoutMs) {
      return client.invoke(tool as KnownZclawTool, args as InvokeArgs, timeoutMs);
    },
    listStores() {
      return client.listStores();
    },
    openStore(input = {}) {
      return client.openStore(input);
    },
    visit(url, options = {}) {
      return client.visit(url, options);
    },
    executeScript(script, returnByValue = true) {
      return client.executeScript(script, returnByValue);
    },
    click(input = {}) {
      return client.click(input);
    },
    screenshot(options = {}) {
      return client.screenshot(options);
    },
    waitElement(selector, options = {}) {
      return client.waitElement(selector, options);
    },
    closeStore(storeId) {
      return client.closeStore(storeId);
    }
  };
}

export function loadFlow(
  flowIdOrFilePath: string,
  options: { repoRoot?: string } = {}
): FlowDefinition {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const filePath = resolveFlowFile(flowIdOrFilePath, repoRoot);
  if (!existsSync(filePath)) {
    throw new FlowEngineError(`流程文件不存在: ${filePath}`, "flow_not_found");
  }
  const parsed = validateFlow(readJsonFile(filePath), { repoRoot });
  if (!parsed.ok || !parsed.flow) {
    throw new FlowValidationError("流程静态校验失败", parsed.issues);
  }
  return parsed.flow;
}

export function validateFlow(
  input: unknown,
  options: { repoRoot?: string; checkExtractExists?: boolean } = {}
): FlowValidationResult {
  return validateFlowContract(input, options);
}

export function parseParams(pairs: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of pairs) {
    const eqIndex = pair.indexOf("=");
    if (eqIndex <= 0) {
      throw new FlowEngineError(
        `参数格式非法: ${pair}，应为 key=value`,
        "invalid_param_pair"
      );
    }
    const key = pair.slice(0, eqIndex);
    if (!key || key.startsWith("-")) {
      throw new FlowEngineError(
        `参数名非法: ${pair}，应为 key=value`,
        "invalid_param_key"
      );
    }
    params[key] = pair.slice(eqIndex + 1);
  }
  return params;
}

export function createFlowRunner(options: FlowRunnerOptions = {}): FlowRunner {
  return new FlowRunner(options);
}

export async function runFlow(
  flowOrId: FlowDefinition | string,
  options: RunFlowOptions = {}
): Promise<FlowRunResult> {
  const flow =
    typeof flowOrId === "string"
      ? loadFlow(flowOrId, { repoRoot: options.repoRoot })
      : flowOrId;
  return new FlowRunner(options).runFlow(flow, options.params);
}

export class FlowRunner {
  private readonly repoRoot: string;
  private readonly dataRoot: string;
  private readonly toolClient: FlowToolClient;
  private readonly sleeper: (ms: number) => Promise<void>;
  private readonly clock: Clock;
  private readonly logger: Pick<Console, "log" | "error">;
  private readonly verbose: boolean;
  private readonly healEnabled: boolean;
  private readonly maxExecutions?: number;

  private context: Record<string, unknown> = {};
  private storeId?: string;
  private targetId?: string;
  private failedStep?: FailedStep;

  constructor(options: FlowRunnerOptions = {}) {
    this.repoRoot = options.repoRoot ?? defaultRepoRoot;
    this.dataRoot = options.dataRoot ?? path.join(this.repoRoot, "data");
    this.toolClient =
      options.toolClient ?? createZClawFlowToolClient(options.zclawOptions ?? {});
    this.sleeper = options.sleeper ?? defaultSleeper;
    this.clock = options.clock ?? { now: () => new Date() };
    this.logger = options.logger ?? console;
    this.verbose = options.verbose ?? false;
    this.healEnabled = options.heal ?? true;
    this.maxExecutions = options.maxExecutions;
  }

  async runFlow(
    flow: FlowDefinition,
    params: Record<string, unknown> = {}
  ): Promise<FlowRunResult> {
    const validation = validateFlow(flow, { repoRoot: this.repoRoot });
    if (!validation.ok) {
      const error = summarizeIssues(validation.issues);
      await this.writeRunLog(flow.id, "failed", 0, error, params);
      return { status: "failed", error, heal: { triggered: false, reason: "validation_failed" } };
    }

    const defaults = Object.fromEntries(
      Object.entries(flow.params ?? {}).filter(([key]) => !key.startsWith("_"))
    );
    const mergedParams = { ...defaults, ...params };
    const maxAttempts = flow.retry?.maxAttempts ?? 1;
    const retryDelay = flow.retry?.delayMs ?? 3000;
    const started = performance.now();

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      this.context = { params: mergedParams };
      this.failedStep = undefined;
      try {
        if (attempt > 1) {
          await this.sleeper(retryDelay);
        }
        const data = await this.executeSteps(flow.steps);
        const durationMs = performance.now() - started;
        await this.writeRunLog(flow.id, "success", durationMs, undefined, mergedParams, data);
        if (flow.on_success?.close_store ?? false) {
          await this.cleanupStore();
        }
        return { status: "success", data };
      } catch (error) {
        if (attempt < maxAttempts) {
          continue;
        }
        const durationMs = performance.now() - started;
        const message = errorMessage(error);
        await this.writeRunLog(flow.id, "failed", durationMs, message, mergedParams);
        if (flow.on_fail_final?.close_store ?? true) {
          await this.cleanupStore();
        }
        return {
          status: "failed",
          error: message,
          failed_step: this.failedStep,
          heal: this.createHealMetadata(flow, message)
        };
      }
    }

    return { status: "exhausted", error: "所有重试均失败" };
  }

  resolveVariables(value: unknown): unknown {
    return this.resolveVars(value);
  }

  evalCondition(condition: Record<string, unknown>): boolean {
    return this.evaluateCondition(condition);
  }

  private async executeSteps(steps: FlowStep[]): Promise<Record<string, unknown>> {
    const idIndex = new Map<string, number>();
    steps.forEach((step, index) => {
      if (step.id) {
        if (idIndex.has(step.id)) {
          throw new FlowEngineError(`步骤 id 重复: ${step.id}`, "duplicate_step_id");
        }
        idIndex.set(step.id, index);
      }
    });

    const results: Record<string, unknown> = {};
    const maxExecutions = this.maxExecutions ?? Math.max(100, steps.length * 10);
    let index = 0;
    let executed = 0;

    while (index >= 0 && index < steps.length) {
      const step = steps[index]!;
      const stepId = step.id ?? `step_${index}`;
      executed += 1;
      if (executed > maxExecutions) {
        throw new FlowEngineError(
          `步骤执行次数超过 ${maxExecutions}，疑似分支死循环，已中止`,
          "possible_branch_loop"
        );
      }

      if (step.condition && !this.evaluateCondition(step.condition)) {
        index += 1;
        continue;
      }

      if (step.action === "branch") {
        const target = this.evaluateBranch(step);
        if (target === "end") {
          break;
        }
        index = target ? resolveTarget(target, idIndex, stepId) : index + 1;
        continue;
      }

      if (step.action === "goto") {
        const target = step.target;
        if (target === "end") {
          break;
        }
        index = resolveTarget(target, idIndex, stepId);
        continue;
      }

      const control = await this.executeStepWithFailureHandling(step);
      if (control.result !== undefined) {
        results[stepId] = control.result;
      }
      if (step.save && control.result !== undefined) {
        this.context[step.save] = control.result;
      }

      if (control.kind === "end") {
        break;
      }
      if (control.kind === "jump") {
        index = resolveTarget(control.target, idIndex, stepId);
        continue;
      }

      const target = step.branch
        ? this.evaluateBranch({ branch: step.branch } as FlowStep)
        : step.goto;
      if (target === "end") {
        break;
      }
      if (target) {
        index = resolveTarget(target, idIndex, stepId);
        continue;
      }
      index += 1;
    }

    return results;
  }

  private async executeStepWithFailureHandling(step: FlowStep): Promise<StepControl> {
    try {
      const result = await this.executeStepWithRetry(step);
      this.validateResult(step, result);
      return { kind: "next", result };
    } catch (error) {
      const onFail = step.on_fail ?? { action: "abort" };
      const action = onFail.action ?? "abort";
      if (action === "skip") {
        return {
          kind: "next",
          result: { skipped: true, error: errorMessage(error) }
        };
      }
      if (action === "branch") {
        if (onFail.target === "end") {
          return {
            kind: "end",
            result: { failed: true, branched_to: "end", error: errorMessage(error) }
          };
        }
        return {
          kind: "jump",
          target: onFail.target ?? "",
          result: {
            failed: true,
            branched_to: onFail.target,
            error: errorMessage(error)
          }
        };
      }
      this.recordFailure(step, error);
      throw error;
    }
  }

  private async executeStepWithRetry(step: FlowStep): Promise<unknown> {
    const onFail = step.on_fail;
    if (onFail?.action !== "retry") {
      return this.executeStep(step);
    }

    const maxAttempts = onFail.maxAttempts ?? 3;
    const delayMs = onFail.delayMs ?? 3000;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await this.executeStep(step);
        this.validateResult(step, result);
        return result;
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts) {
          await this.sleeper(delayMs);
        }
      }
    }
    this.recordFailure(step, lastError);
    throw lastError;
  }

  private async executeStep(step: FlowStep): Promise<unknown> {
    if (step.tool) {
      return this.executeTool(step);
    }
    if (step.action) {
      return this.executeAction(step);
    }
    throw new FlowEngineError(`步骤缺少 tool 或 action: ${step.id ?? "unknown"}`);
  }

  private async executeTool(step: FlowStep): Promise<unknown> {
    const tool = step.tool;
    if (!tool) {
      throw new FlowEngineError(`步骤缺少 tool: ${step.id ?? "unknown"}`);
    }
    const args = this.resolveVars(step.args ?? {}) as Record<string, unknown>;

    if (tool === "list_stores") {
      const stores = this.toolClient.listStores
        ? await this.toolClient.listStores()
        : normalizeStores(await this.toolClient.invoke("list_stores", { all: true }));
      return { items: stores, count: stores.length };
    }

    if (tool === "open_store") {
      if (!args.storeId && !args.storeName) {
        const params = this.context.params as Record<string, unknown>;
        if (params.store_id) {
          args.storeId = params.store_id;
        } else if (params.store_name) {
          args.storeName = params.store_name;
        } else {
          const storesData = this.context.stores as { items?: unknown[] } | undefined;
          const items = storesData?.items ?? normalizeStores(await this.toolClient.invoke("list_stores", { all: true }));
          if (items.length === 0) {
            throw new FlowEngineError("没有找到任何店铺", "store_not_found");
          }
          if ((step.store_selector ?? "first") !== "first") {
            throw new FlowEngineError(`未知的店铺选择策略: ${step.store_selector}`);
          }
          const first = items[0];
          if (isRecord(first) && typeof first.storeId === "string") {
            args.storeId = first.storeId;
          }
        }
      }
      const data = this.toolClient.openStore
        ? await this.toolClient.openStore({
            storeId: stringValue(args.storeId),
            storeName: stringValue(args.storeName),
            launchUrl: stringValue(args.launchUrl)
          })
        : await this.toolClient.invoke("open_store", args, 60000);
      this.syncTargets(data);
      return data;
    }

    if (tool === "visit_page") {
      const data = this.toolClient.visit
        ? await this.toolClient.visit(String(args.url), {
            waitUntil: stringValue(args.waitUntil) ?? "domcontentloaded",
            timeoutMs: numberValue(args.timeoutMs) ?? 30000
          })
        : await this.toolClient.invoke("visit_page", {
            url: args.url,
            waitUntil: args.waitUntil ?? "domcontentloaded",
            timeoutMs: args.timeoutMs ?? 30000
          });
      this.syncTargets(data);
      return data;
    }

    if (tool === "execute_script") {
      const script = this.loadScript(String(args.script ?? ""));
      const returnByValue = args.returnByValue !== false;
      return this.toolClient.executeScript
        ? this.toolClient.executeScript(script, returnByValue)
        : this.toolClient.invoke("execute_script", { script, returnByValue });
    }

    if (tool === "click_element") {
      return this.toolClient.click
        ? this.toolClient.click({
            selector: stringValue(args.selector),
            hint: stringValue(args.hint),
            waitForNavigation: Boolean(args.waitForNavigation),
            timeoutMs: numberValue(args.timeoutMs) ?? 10000
          })
        : this.toolClient.invoke("click_element", args);
    }

    if (tool === "take_screenshot") {
      if (this.toolClient.screenshot) {
        const filePath = await this.toolClient.screenshot({
          fullPage: Boolean(args.fullPage),
          format: stringValue(args.format) === "jpeg" ? "jpeg" : "png"
        });
        return { filePath };
      }
      return this.toolClient.invoke("take_screenshot", args);
    }

    if (tool === "wait_for_element") {
      return this.toolClient.waitElement
        ? this.toolClient.waitElement(String(args.selector), {
            timeoutMs: numberValue(args.timeoutMs) ?? 10000,
            state: stringValue(args.state) ?? "visible"
          })
        : this.toolClient.invoke("wait_for_element", args);
    }

    if (tool === "close_store") {
      return this.cleanupStore();
    }

    if (!KNOWN_ZCLAW_TOOL_SET.has(tool)) {
      throw new FlowEngineError(`未知工具: ${tool}`, "unknown_tool");
    }
    return this.toolClient.invoke(tool, args);
  }

  private async executeAction(step: FlowStep): Promise<unknown> {
    const action = step.action;
    if (action === "sleep") {
      const seconds = Number(this.resolveVars((step as Record<string, unknown>).seconds ?? 1));
      await this.sleeper(seconds * 1000);
      return { slept: seconds };
    }
    if (action === "print") {
      const message = this.resolveVars((step as Record<string, unknown>).message ?? "");
      if (this.verbose) {
        this.logger.log(`    ${String(message)}`);
      }
      return { printed: message };
    }
    if (action === "assert") {
      const value = this.resolveVars((step as Record<string, unknown>).value);
      const expected = this.resolveVars((step as Record<string, unknown>).expected);
      const check = String((step as Record<string, unknown>).check ?? "eq");
      if (!assertCheck(check, value, expected)) {
        throw new FlowEngineError(
          `断言失败(${check}): value=${String(value).slice(0, 100)} expected=${String(expected)}`,
          "assert_failed"
        );
      }
      return { asserted: true };
    }
    if (action === "fail") {
      throw new FlowEngineError(
        String(this.resolveVars((step as Record<string, unknown>).message ?? "流程主动标记失败")),
        "flow_marked_failed"
      );
    }
    if (action === "save_json") {
      const data = this.resolveVars((step as Record<string, unknown>).data);
      const filename = String(this.resolveVars((step as Record<string, unknown>).filename ?? "output.json"));
      const filePath = this.resolveOutputPath(filename);
      ensureParentDir(filePath);
      writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      return { filePath };
    }
    if (action === "save_csv") {
      const data = this.resolveVars((step as Record<string, unknown>).data);
      const header = this.resolveVars((step as Record<string, unknown>).header);
      const filename = String(this.resolveVars((step as Record<string, unknown>).filename ?? "output.csv"));
      const filePath = this.resolveOutputPath(filename);
      const rows = Array.isArray(data) ? data : [];
      const lines: string[] = [];
      if (Array.isArray(header)) {
        lines.push(toCsvRow(header));
      }
      for (const row of rows) {
        lines.push(toCsvRow(Array.isArray(row) ? row : Object.values(row as Record<string, unknown>)));
      }
      ensureParentDir(filePath);
      writeFileSync(filePath, `\uFEFF${lines.join("\n")}${lines.length ? "\n" : ""}`, "utf8");
      return { filePath, rows: rows.length };
    }
    if (action === "close_store") {
      return this.cleanupStore();
    }
    throw new FlowEngineError(`未知动作: ${action}`, "unknown_action");
  }

  private validateResult(step: FlowStep, result: unknown): void {
    const rules = step.validate;
    if (!rules) {
      return;
    }
    let data = result;
    if (rules.path) {
      data = lookupPath(data, rules.path);
    }
    const stepId = step.id ?? "?";
    if (rules.not_empty && isEmpty(data)) {
      throw new FlowValidationError(`步骤 ${stepId} 结果为空 (path=${rules.path ?? "."})`);
    }
    if (rules.min_rows !== undefined) {
      const count =
        Array.isArray(data) || typeof data === "string"
          ? data.length
          : isRecord(data)
            ? Object.keys(data).length
            : 0;
      if (count < rules.min_rows) {
        throw new FlowValidationError(
          `步骤 ${stepId} 行数不足: ${count} < ${rules.min_rows} (path=${rules.path ?? "."})`
        );
      }
    }
    for (const field of rules.require_fields ?? []) {
      const row = Array.isArray(data) ? data[0] : data;
      if (!isRecord(row) || row[field] === undefined || row[field] === null) {
        throw new FlowValidationError(`步骤 ${stepId} 缺少必需字段: ${field}`);
      }
    }
    if (rules.contains !== undefined && !String(data).includes(String(rules.contains))) {
      throw new FlowValidationError(`步骤 ${stepId} 结果不包含: ${String(rules.contains)}`);
    }
  }

  private evaluateCondition(condition: Record<string, unknown>): boolean {
    const type = String(condition.type ?? "eq");
    const left = this.resolveVars(condition.left);
    const right = this.resolveVars(condition.right);
    try {
      if (type === "eq") return left === right;
      if (type === "ne") return left !== right;
      if (type === "contains") return String(left).includes(String(right));
      if (type === "not_contains") return !String(left).includes(String(right));
      if (type === "starts_with") return String(left).startsWith(String(right));
      if (type === "is_true") return Boolean(left) && !["false", "False", "0"].includes(String(left));
      if (type === "is_false") return !Boolean(left) || ["false", "False", "0"].includes(String(left));
      if (type === "gt") return Number(left) > Number(right);
      if (type === "lt") return Number(left) < Number(right);
      if (type === "is_empty") return isEmpty(left);
      if (type === "not_empty") return !isEmpty(left);
    } catch {
      return false;
    }
    return true;
  }

  private evaluateBranch(step: FlowStep): string | undefined {
    const spec = step.branch ?? (step as unknown as { cases?: unknown[]; default?: string });
    for (const branchCase of spec.cases ?? []) {
      if (
        isRecord(branchCase) &&
        (!branchCase.condition || this.evaluateCondition(branchCase.condition as Record<string, unknown>))
      ) {
        return stringValue(branchCase.goto);
      }
    }
    return stringValue(spec.default);
  }

  private resolveVars(value: unknown): unknown {
    if (typeof value === "string") {
      return this.resolveVar(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.resolveVars(item));
    }
    if (isRecord(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, this.resolveVars(nested)])
      );
    }
    return value;
  }

  private resolveVar(value: string): unknown {
    if (!value.includes("${")) {
      return value;
    }
    const pureMatch = value.match(/^\$\{([^}]+)\}$/);
    if (pureMatch) {
      const resolved = this.lookupContext(pureMatch[1]!);
      if (resolved !== undefined) {
        return resolved;
      }
    }
    return value.replace(/\$\{([^}]+)\}/g, (match, key: string) => {
      const resolved = this.lookupContext(key);
      return resolved === undefined ? match : String(resolved);
    });
  }

  private lookupContext(keyPath: string): unknown {
    if (keyPath === "date") {
      return formatDate(this.clock.now());
    }
    if (keyPath === "datetime") {
      return formatDateTime(this.clock.now());
    }
    if (keyPath === "timestamp") {
      return String(Math.floor(this.clock.now().getTime() / 1000));
    }
    return lookupPath(this.context, keyPath);
  }

  private loadScript(script: string): string {
    if (!script.startsWith("@")) {
      return script;
    }
    const scriptPath = path.join(this.repoRoot, script.slice(1));
    if (!existsSync(scriptPath)) {
      throw new FlowEngineError(`脚本文件不存在: ${scriptPath}`, "missing_extract");
    }
    return String(this.resolveVar(readFileSync(scriptPath, "utf8")));
  }

  private syncTargets(data: unknown): void {
    if (isRecord(data)) {
      if (typeof data.storeId === "string") {
        this.storeId = data.storeId;
        this.toolClient.storeId = data.storeId;
      }
      const nested = isRecord(data.data) ? data.data : data;
      if (typeof nested.targetId === "string") {
        this.targetId = nested.targetId;
        this.toolClient.targetId = nested.targetId;
      }
    }
  }

  private async cleanupStore(): Promise<unknown> {
    const storeId = this.storeId ?? this.toolClient.storeId;
    try {
      const result = this.toolClient.closeStore
        ? await this.toolClient.closeStore(storeId)
        : await this.toolClient.invoke("close_store", storeId ? { storeId } : {});
      this.storeId = undefined;
      this.toolClient.storeId = undefined;
      return result ?? { closed: true };
    } catch (error) {
      if (this.verbose) {
        this.logger.error(`关闭店铺失败: ${errorMessage(error)}`);
      }
      return { closed: false, error: errorMessage(error) };
    }
  }

  private recordFailure(step: FlowStep, error: unknown): void {
    let args: unknown = step.args ?? {};
    try {
      args = this.resolveVars(args);
    } catch {
      // Keep raw args if variable resolution itself failed.
    }
    this.failedStep = {
      step_id: step.id ?? "unknown",
      tool: step.tool,
      action: step.action,
      args,
      heal_context: step.on_fail?.context,
      error: errorMessage(error).slice(0, 500)
    };
  }

  private createHealMetadata(
    flow: FlowDefinition,
    error: string
  ): Record<string, unknown> {
    if (!this.healEnabled) {
      return { triggered: false, reason: "disabled_by_cli" };
    }
    if (flow.on_fail_final?.heal === false) {
      return { triggered: false, reason: "disabled_by_flow" };
    }
    return {
      triggered: false,
      reason: "m3_metadata_only",
      flow_id: flow.id,
      error,
      failed_step: this.failedStep,
      store_id: this.storeId,
      target_id: this.targetId
    };
  }

  private async writeRunLog(
    flowId: string,
    status: string,
    durationMs: number,
    error?: string,
    params?: Record<string, unknown>,
    data?: Record<string, unknown>
  ): Promise<void> {
    const entry = {
      flow_id: flowId,
      timestamp: formatDateTime(this.clock.now()),
      status,
      duration_ms: Math.round(durationMs),
      error: error ? error.slice(0, 500) : null,
      params: Object.fromEntries(
        Object.entries(params ?? {}).map(([key, value]) => [key, String(value).slice(0, 100)])
      ),
      data_summary: Object.fromEntries(
        Object.entries(data ?? {}).map(([key, value]) => [key, summaryValue(value, 200)])
      )
    };
    RunLogEntrySchema.parse(entry);
    const logFile = path.join(this.dataRoot, "logs", "runs.jsonl");
    ensureParentDir(logFile);
    await appendFile(logFile, `${JSON.stringify(entry)}\n`, "utf8");
  }

  private resolveOutputPath(filename: string): string {
    return path.isAbsolute(filename)
      ? filename
      : path.join(this.dataRoot, "output", filename);
  }
}

function resolveFlowFile(flowIdOrFilePath: string, repoRoot: string): string {
  if (
    path.isAbsolute(flowIdOrFilePath) ||
    flowIdOrFilePath.endsWith(".json") ||
    flowIdOrFilePath.includes("/") ||
    flowIdOrFilePath.includes("\\")
  ) {
    return path.resolve(repoRoot, flowIdOrFilePath);
  }
  return path.join(repoRoot, "flows", `${flowIdOrFilePath}.json`);
}

function resolveTarget(
  target: string | undefined,
  idIndex: Map<string, number>,
  fromStep: string
): number {
  if (!target || !idIndex.has(target)) {
    throw new FlowEngineError(`步骤 ${fromStep} 的跳转目标不存在: ${target}`, "missing_target");
  }
  return idIndex.get(target)!;
}

function lookupPath(value: unknown, keyPath: string): unknown {
  let current = value;
  for (const part of keyPath.split(".")) {
    if (isRecord(current)) {
      current = current[part];
    } else if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)];
    } else {
      return undefined;
    }
    if (current === undefined || current === null) {
      return current;
    }
  }
  return current;
}

function normalizeStores(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (isRecord(value) && Array.isArray(value.items)) {
    return value.items;
  }
  return [];
}

function assertCheck(check: string, value: unknown, expected: unknown): boolean {
  if (check === "eq") return value === expected;
  if (check === "ne") return value !== expected;
  if (check === "gt") return Number(value) > Number(expected);
  if (check === "contains") return String(value).includes(String(expected));
  if (check === "not_empty") return !isEmpty(value);
  return true;
}

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (isRecord(value) && Object.keys(value).length === 0)
  );
}

function toCsvRow(row: unknown[]): string {
  return row
    .map((cell) => {
      const text = String(cell ?? "");
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    })
    .join(",");
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatDateTime(date: Date): string {
  return `${formatDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function ensureParentDir(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarizeIssues(issues: ValidationIssue[]): string {
  return issues.map((item) => `[${item.level}] ${item.message}`).join("; ");
}

function summaryValue(value: unknown, maxLength: number): string {
  if (typeof value === "string") {
    return value.slice(0, maxLength);
  }
  if (value === undefined) {
    return "undefined";
  }
  try {
    return JSON.stringify(value).slice(0, maxLength);
  } catch {
    return String(value).slice(0, maxLength);
  }
}
