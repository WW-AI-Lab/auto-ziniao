import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { defaultRepoRoot } from "@ww-ai-lab/auto-ziniao-core";
import {
  CONDITION_TYPE_SET,
  KNOWN_FLOW_ACTION_SET,
  KNOWN_ZCLAW_TOOL_SET,
  ON_FAIL_ACTION_SET
} from "./constants.js";

const JsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type JsonValue = z.infer<typeof JsonPrimitiveSchema> | JsonValue[] | { [key: string]: JsonValue };

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([JsonPrimitiveSchema, z.array(JsonValueSchema), z.record(JsonValueSchema)])
);

export const FlowParamsSchema = z.record(JsonValueSchema).default({});

export const RetrySchema = z
  .object({
    maxAttempts: z.number().int().positive().optional(),
    delayMs: z.number().nonnegative().optional()
  })
  .passthrough();

export const ConditionSchema = z
  .object({
    type: z.string(),
    left: JsonValueSchema.optional(),
    right: JsonValueSchema.optional()
  })
  .passthrough();

export const ValidateRuleSchema = z
  .object({
    not_empty: z.boolean().optional(),
    min_rows: z.number().int().nonnegative().optional(),
    require_fields: z.array(z.string()).optional(),
    contains: JsonValueSchema.optional(),
    path: z.string().optional()
  })
  .passthrough();

export const OnFailSchema = z
  .object({
    action: z.string().default("abort"),
    delayMs: z.number().nonnegative().optional(),
    maxAttempts: z.number().int().positive().optional(),
    context: z.string().optional(),
    target: z.string().optional()
  })
  .passthrough();

export const BranchCaseSchema = z
  .object({
    condition: ConditionSchema.optional(),
    goto: z.string().optional()
  })
  .passthrough();

export const BranchSchema = z
  .object({
    cases: z.array(BranchCaseSchema).default([]),
    default: z.string().optional()
  })
  .passthrough();

export const StepRiskSchema = z.enum(["read", "navigate", "write", "critical"]);

export const StepPacingSchema = z
  .object({
    beforeMs: z.number().int().nonnegative().optional(),
    afterMs: z.number().int().nonnegative().optional(),
    timeoutMs: z.number().int().nonnegative().optional(),
    requiresConfirm: z.boolean().optional(),
    reason: z.string().optional(),
    postconditionExempt: z.boolean().optional()
  })
  .passthrough();

export const ConfirmGateSchema = z
  .object({
    allowParam: z.string().min(1).optional(),
    message: z.string().optional(),
    exempt: z.boolean().optional(),
    reason: z.string().optional()
  })
  .passthrough();

export const PacingPolicySchema = z
  .object({
    profile: z.string().optional(),
    jitter: z
      .object({
        enabled: z.boolean().default(false),
        ratio: z.number().min(0).max(1).default(0)
      })
      .passthrough()
      .optional(),
    limits: z
      .object({
        perStoreConcurrency: z.number().int().positive().optional(),
        perFlowConcurrency: z.number().int().positive().optional(),
        maxConsecutiveFailures: z.number().int().positive().optional(),
        maxRunPerDay: z.number().int().positive().optional()
      })
      .passthrough()
      .optional(),
    defaults: z
      .object({
        read: StepPacingSchema.optional(),
        navigate: StepPacingSchema.optional(),
        write: StepPacingSchema.optional(),
        critical: StepPacingSchema.optional()
      })
      .passthrough()
      .optional(),
    budgets: z
      .object({
        perStoreConcurrency: z.number().int().positive().optional(),
        perFlowConcurrency: z.number().int().positive().optional(),
        maxConsecutiveFailures: z.number().int().positive().optional(),
        maxRunPerDay: z.number().int().positive().optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough();

export const FlowStepSchema = z
  .object({
    id: z.string().optional(),
    tool: z.string().optional(),
    action: z.string().optional(),
    args: z.record(JsonValueSchema).default({}),
    risk: StepRiskSchema.optional(),
    pacing: StepPacingSchema.optional(),
    confirm: ConfirmGateSchema.optional(),
    save: z.string().optional(),
    condition: ConditionSchema.optional(),
    validate: ValidateRuleSchema.optional(),
    on_fail: OnFailSchema.optional(),
    goto: z.string().optional(),
    target: z.string().optional(),
    branch: BranchSchema.optional(),
    store_selector: z.string().optional()
  })
  .passthrough();

export const FlowDefinitionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.number().int().positive(),
    enabled: z.boolean(),
    schedule: z.string().optional().default(""),
    description: z.string().default(""),
    retry: RetrySchema.optional(),
    pacing: PacingPolicySchema.optional(),
    params: FlowParamsSchema,
    steps: z.array(FlowStepSchema).nonempty(),
    on_success: z
      .object({
        close_store: z.boolean().optional()
      })
      .passthrough()
      .optional(),
    on_fail_final: z
      .object({
        notify: z.boolean().optional(),
        close_store: z.boolean().optional(),
        heal: z.boolean().optional()
      })
      .passthrough()
      .optional(),
    heal: z
      .object({
        hints: z.string().optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough();

export type FlowDefinition = z.infer<typeof FlowDefinitionSchema>;
export type FlowStep = z.infer<typeof FlowStepSchema>;
export type StepRisk = z.infer<typeof StepRiskSchema>;
export type StepPacing = z.infer<typeof StepPacingSchema>;
export type ConfirmGate = z.infer<typeof ConfirmGateSchema>;
export type PacingPolicy = z.infer<typeof PacingPolicySchema>;

export type ValidationIssueLevel = "error" | "warn";

export type ValidationIssue = {
  level: ValidationIssueLevel;
  message: string;
  stepId?: string;
  code?: string;
};

export type FlowValidationResult = {
  ok: boolean;
  flow?: FlowDefinition;
  issues: ValidationIssue[];
  extractRefs: string[];
};

export function parseFlowDefinition(input: unknown): FlowDefinition {
  return FlowDefinitionSchema.parse(input);
}

export function getDeclaredParams(flow: Pick<FlowDefinition, "params">): Set<string> {
  return new Set(
    Object.keys(flow.params ?? {}).filter((key) => !key.startsWith("_"))
  );
}

export function collectExtractRefs(flow: Pick<FlowDefinition, "steps">): string[] {
  const refs = new Set<string>();
  for (const step of flow.steps) {
    const script = step.args?.script;
    if (typeof script === "string" && script.startsWith("@")) {
      refs.add(script);
    }
  }
  return [...refs].sort((a, b) => a.localeCompare(b));
}

function issue(
  level: ValidationIssueLevel,
  message: string,
  stepId?: string,
  code?: string
): ValidationIssue {
  return { level, message, stepId, code };
}

function collectTargets(step: FlowStep): (string | undefined)[] {
  const targets: (string | undefined)[] = [];
  if (step.goto) {
    targets.push(step.goto);
  }
  if (step.action === "goto") {
    targets.push(step.target);
  }
  const branch = step.branch ?? (step.action === "branch" ? step : undefined);
  if (branch) {
    const branchSpec = branch as FlowStep & { cases?: BranchCase[]; default?: string };
    for (const branchCase of branchSpec.cases ?? []) {
      targets.push(branchCase.goto);
    }
    if (branchSpec.default) {
      targets.push(branchSpec.default);
    }
  }
  return targets;
}

type BranchCase = z.infer<typeof BranchCaseSchema>;

const OPERATION_TOOL_SET = new Set([
  "click_element",
  "input_text",
  "scroll_page",
  "run_automation"
]);

function hasPostcondition(flow: FlowDefinition, step: FlowStep, index: number): boolean {
  if (step.validate || step.pacing?.postconditionExempt) {
    return true;
  }
  const next = flow.steps[index + 1];
  if (!next) {
    return false;
  }
  return next.action === "assert" || next.tool === "wait_for_element" || next.tool === "wait_for_navigation";
}

function validatePacingContract(flow: FlowDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  flow.steps.forEach((step, index) => {
    const stepId = step.id ?? `step_${index}`;
    if (step.tool && OPERATION_TOOL_SET.has(step.tool) && !step.risk) {
      issues.push(
        issue("warn", `步骤 ${stepId} 是操作类工具但未声明 risk`, stepId, "missing_step_risk")
      );
    }
    if (step.risk === "critical" && !step.confirm) {
      issues.push(
        issue("error", `步骤 ${stepId} 为 critical 风险但缺少 confirm`, stepId, "critical_requires_confirm")
      );
    }
    if ((step.risk === "write" || step.risk === "critical") && !hasPostcondition(flow, step, index)) {
      issues.push(
        issue("warn", `步骤 ${stepId} 为 ${step.risk} 风险但缺少后置验证`, stepId, "missing_write_postcondition")
      );
    }
  });
  return issues;
}

function findParamRefs(value: unknown): string[] {
  const raw = JSON.stringify(value);
  if (!raw) {
    return [];
  }
  return [...raw.matchAll(/\$\{params\.([A-Za-z0-9_]+)\}/g)].map(
    (match) => match[1] ?? ""
  );
}

function validateConditionTypes(step: FlowStep, stepId: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const conditions: unknown[] = [];
  if (step.condition) {
    conditions.push(step.condition);
  }
  const branch = step.branch ?? (step.action === "branch" ? step : undefined);
  if (branch && "cases" in branch) {
    for (const branchCase of (branch.cases as BranchCase[] | undefined) ?? []) {
      if (branchCase.condition) {
        conditions.push(branchCase.condition);
      }
    }
  }
  for (const condition of conditions) {
    if (
      condition &&
      typeof condition === "object" &&
      "type" in condition &&
      typeof condition.type === "string" &&
      !CONDITION_TYPE_SET.has(condition.type)
    ) {
      issues.push(
        issue("error", `步骤 ${stepId} 的 condition.type 非法: ${condition.type}`, stepId, "invalid_condition")
      );
    }
  }
  return issues;
}

export function validateFlowContract(
  input: unknown,
  options: { repoRoot?: string; checkExtractExists?: boolean } = {}
): FlowValidationResult {
  const parsed = FlowDefinitionSchema.safeParse(input);
  const issues: ValidationIssue[] = [];
  if (!parsed.success) {
    for (const err of parsed.error.issues) {
      issues.push(
        issue("error", `${err.path.join(".") || "flow"}: ${err.message}`, undefined, "schema")
      );
    }
    return { ok: false, issues, extractRefs: [] };
  }

  const flow = parsed.data;
  const ids = new Set<string>();
  const duplicateIds = new Set<string>();

  flow.steps.forEach((step, index) => {
    const stepId = step.id;
    if (!stepId) {
      issues.push(issue("warn", `第 ${index} 步缺少 id（跳转将无法指向它）`, undefined, "missing_step_id"));
      return;
    }
    if (ids.has(stepId)) {
      duplicateIds.add(stepId);
      issues.push(issue("error", `步骤 id 重复: ${stepId}`, stepId, "duplicate_step_id"));
    }
    ids.add(stepId);
  });

  const validTargets = new Set([...ids, "end"]);
  const declaredParams = getDeclaredParams(flow);

  for (const step of flow.steps) {
    const stepId = step.id ?? "?";
    if (!step.tool && !step.action) {
      issues.push(issue("error", `步骤 ${stepId} 缺少 tool 或 action`, stepId, "missing_tool_or_action"));
    }
    if (step.tool && !KNOWN_ZCLAW_TOOL_SET.has(step.tool)) {
      issues.push(
        issue(
          "error",
          `步骤 ${stepId} 使用了未知工具: ${step.tool}（合法工具见 GET /zclaw/tools）`,
          stepId,
          "unknown_tool"
        )
      );
    }
    if (step.action && !KNOWN_FLOW_ACTION_SET.has(step.action)) {
      issues.push(issue("warn", `步骤 ${stepId} 使用了未知动作: ${step.action}`, stepId, "unknown_action"));
    }

    const onFail = step.on_fail;
    if (onFail) {
      const failAction = onFail.action ?? "abort";
      if (!ON_FAIL_ACTION_SET.has(failAction)) {
        issues.push(issue("error", `步骤 ${stepId} 的 on_fail.action 非法: ${failAction}`, stepId, "invalid_on_fail"));
      }
      if (failAction === "branch" && !validTargets.has(onFail.target ?? "")) {
        issues.push(
          issue(
            "error",
            `步骤 ${stepId} 的 on_fail.target 不存在: ${onFail.target}`,
            stepId,
            "missing_on_fail_target"
          )
        );
      }
    }

    for (const target of collectTargets(step)) {
      if (!target || !validTargets.has(target)) {
        issues.push(issue("error", `步骤 ${stepId} 跳转目标不存在: ${target}`, stepId, "missing_target"));
      }
    }

    for (const paramName of findParamRefs(step)) {
      if (!declaredParams.has(paramName)) {
        issues.push(
          issue("warn", `步骤 ${stepId} 引用了未声明的参数: params.${paramName}`, stepId, "undeclared_param")
        );
      }
    }

    issues.push(...validateConditionTypes(step, stepId));
  }

  issues.push(...validatePacingContract(flow));

  const extractRefs = collectExtractRefs(flow);
  if (options.checkExtractExists ?? true) {
    const repoRoot = options.repoRoot ?? defaultRepoRoot;
    for (const ref of extractRefs) {
      const extractPath = path.join(repoRoot, ref.slice(1));
      if (!existsSync(extractPath)) {
        issues.push(issue("error", `引用的脚本文件不存在: ${ref}`, undefined, "missing_extract"));
      }
    }
  }

  const hasErrors = issues.some((item) => item.level === "error");
  return { ok: !hasErrors && duplicateIds.size === 0, flow, issues, extractRefs };
}
