import { z } from "zod";
import { RunLogEntrySchema } from "./runtime-data.js";

const UnknownRecordSchema = z.record(z.unknown());

export const ScheduleTriggerSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("interval"), minutes: z.number().int().positive() }).passthrough(),
    z.object({ type: z.literal("daily"), time: z.string() }).passthrough(),
    z.object({ type: z.literal("cron"), expr: z.string() }).passthrough()
  ])
  .or(z.object({ type: z.string() }).passthrough());

export const ScheduleRunSchema = z
  .object({
    id: z.number().optional(),
    schedule_id: z.string(),
    fired_at: z.string(),
    status: z.enum(["success", "failed", "timeout", "skipped"]).or(z.string()),
    exit_code: z.number().nullable().optional(),
    duration_ms: z.number().nullable().optional(),
    error: z.string().nullable().optional()
  })
  .passthrough();

export const ScheduleSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    flow_id: z.string(),
    params: z.record(z.string()).default({}),
    trigger: ScheduleTriggerSchema,
    enabled: z.boolean(),
    next_run_at: z.string().nullable().optional(),
    created_at: z.string(),
    updated_at: z.string(),
    latest_run: ScheduleRunSchema.nullable().optional()
  })
  .passthrough();

export const ChatToolCallSchema = z.object({ name: z.string() }).passthrough();

export const ChatExtrasSchema = z
  .object({
    reasoning: z.string().optional(),
    tools: z.array(ChatToolCallSchema).optional()
  })
  .passthrough();

export const ChatSessionSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    agent: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    busy: z.boolean().optional()
  })
  .passthrough();

export const ChatMessageSchema = z
  .object({
    id: z.number().optional(),
    session_id: z.string(),
    role: z.enum(["user", "assistant"]).or(z.string()),
    content: z.string().default(""),
    status: z.enum(["pending", "done", "failed"]).or(z.string()).default("done"),
    error: z.string().nullable().optional(),
    extras: ChatExtrasSchema.nullable().optional(),
    created_at: z.string()
  })
  .passthrough();

export const ChatAgentInfoSchema = z
  .object({
    name: z.string(),
    timeout_sec: z.number()
  })
  .passthrough();

export const ApiErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.unknown().optional()
      })
      .passthrough()
  })
  .passthrough();

export const ApiListResponseSchema = <T extends z.ZodTypeAny>(item: T) =>
  z
    .object({
      items: z.array(item),
      total: z.number().int().nonnegative().optional(),
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional()
    })
    .passthrough();

export const FlowSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    version: z.number().or(z.string()).optional(),
    enabled: z.boolean().optional(),
    schedule: z.string().optional(),
    description: z.string().optional(),
    params: UnknownRecordSchema.default({}),
    file: z.string().optional(),
    last_run: RunLogEntrySchema.nullable().optional(),
    running: z.boolean().optional()
  })
  .passthrough();

export const ExtractReferenceSchema = z
  .object({
    path: z.string(),
    exists: z.boolean(),
    content: z.string().nullable().optional()
  })
  .passthrough();

export const FlowDetailSchema = z
  .object({
    id: z.string(),
    content: z.string(),
    extracts: z.array(ExtractReferenceSchema).default([]),
    last_run: RunLogEntrySchema.nullable().optional(),
    running: z.boolean().optional()
  })
  .passthrough();

export const ManualRunStatusSchema = z
  .object({
    token: z.string(),
    flow_id: z.string(),
    params: UnknownRecordSchema.default({}),
    status: z.enum(["running", "success", "failed", "timeout", "skipped", "error"]).or(z.string()),
    started_at: z.string().optional(),
    finished_at: z.string().nullable().optional(),
    exit_code: z.number().nullable().optional(),
    duration_ms: z.number().nullable().optional(),
    output: z.string().optional(),
    error: z.string().nullable().optional(),
    heal: z.unknown().optional()
  })
  .passthrough();

export const OutputFileEntrySchema = z
  .object({
    name: z.string(),
    path: z.string().optional(),
    size: z.number().int().nonnegative().optional(),
    mtime: z.number().or(z.string()).optional(),
    type: z.enum(["file", "dir"]).or(z.string()).optional(),
    preview: z.unknown().optional()
  })
  .passthrough();

export const OutputDirectorySchema = z
  .object({
    path: z.string(),
    dirs: z.array(OutputFileEntrySchema).default([]),
    files: z.array(OutputFileEntrySchema).default([])
  })
  .passthrough();

export const OutputPreviewSchema = z
  .object({
    too_large: z.boolean().optional(),
    binary: z.boolean().optional(),
    size: z.number().int().nonnegative(),
    name: z.string().optional(),
    content: z.string().optional(),
    message: z.string().optional()
  })
  .passthrough();

export const HealEntrySchema = z
  .object({
    heal_id: z.string().optional(),
    timestamp: z.string().optional(),
    event: z.string().optional(),
    flow_id: z.string().optional(),
    step_id: z.string().optional(),
    error_type: z.string().optional(),
    reason: z.string().optional()
  })
  .passthrough();

export const HealDetailSchema = z
  .object({
    heal_id: z.string(),
    context: UnknownRecordSchema.nullable(),
    prompt: z.string().nullable()
  })
  .passthrough();

export const WebAdminStatsFlowSchema = z
  .object({
    flow_id: z.string(),
    total: z.number().int().nonnegative(),
    success: z.number().int().nonnegative(),
    success_rate: z.number().int().min(0).max(100),
    last_run: z.string().nullable().optional(),
    last_status: z.string().nullable().optional(),
    heal_count: z.number().int().nonnegative().default(0)
  })
  .passthrough();

export const WebAdminStatsSchema = z
  .object({
    runs_total: z.number().int().nonnegative(),
    runs_success: z.number().int().nonnegative(),
    runs_failed: z.number().int().nonnegative(),
    runs_error: z.number().int().nonnegative().default(0),
    heals_total: z.number().int().nonnegative().default(0),
    flows: z.array(WebAdminStatsFlowSchema).default([]),
    schedules: z
      .object({
        total: z.number().int().nonnegative(),
        enabled: z.number().int().nonnegative()
      })
      .passthrough(),
    chat_sessions: z.number().int().nonnegative().default(0)
  })
  .passthrough();

export const ChatSseEventSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("accepted"), session_id: z.string(), message_id: z.number().optional() }).passthrough(),
    z.object({ type: z.literal("start"), session_id: z.string().optional(), message_id: z.number().optional() }).passthrough(),
    z.object({ type: z.literal("delta"), session_id: z.string().optional(), message_id: z.number().optional(), text: z.string().default("") }).passthrough(),
    z.object({ type: z.literal("reasoning_delta"), session_id: z.string().optional(), message_id: z.number().optional(), text: z.string().default("") }).passthrough(),
    z.object({ type: z.literal("tool_call"), session_id: z.string().optional(), message_id: z.number().optional(), name: z.string() }).passthrough(),
    z.object({ type: z.literal("done"), session_id: z.string().optional(), message_id: z.number().optional(), content: z.string().optional() }).passthrough(),
    z.object({ type: z.literal("error"), session_id: z.string().optional(), message_id: z.number().optional(), message: z.string() }).passthrough(),
    z.object({ type: z.literal("heartbeat") }).passthrough()
  ])
  .or(z.object({ type: z.string() }).passthrough());

export type Schedule = z.infer<typeof ScheduleSchema>;
export type ScheduleRun = z.infer<typeof ScheduleRunSchema>;
export type ChatToolCall = z.infer<typeof ChatToolCallSchema>;
export type ChatExtras = z.infer<typeof ChatExtrasSchema>;
export type ChatSession = z.infer<typeof ChatSessionSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatAgentInfo = z.infer<typeof ChatAgentInfoSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
export type FlowSummary = z.infer<typeof FlowSummarySchema>;
export type FlowDetail = z.infer<typeof FlowDetailSchema>;
export type ManualRunStatus = z.infer<typeof ManualRunStatusSchema>;
export type RunEntry = z.infer<typeof RunLogEntrySchema>;
export type OutputFileEntry = z.infer<typeof OutputFileEntrySchema>;
export type OutputDirectory = z.infer<typeof OutputDirectorySchema>;
export type OutputPreview = z.infer<typeof OutputPreviewSchema>;
export type HealEntry = z.infer<typeof HealEntrySchema>;
export type HealDetail = z.infer<typeof HealDetailSchema>;
export type WebAdminStatsFlow = z.infer<typeof WebAdminStatsFlowSchema>;
export type WebAdminStats = z.infer<typeof WebAdminStatsSchema>;
export type ChatSseEvent = z.infer<typeof ChatSseEventSchema>;
