import { z } from "zod";

const UnknownRecordSchema = z.record(z.unknown());

export const ScheduleTriggerSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("interval"), minutes: z.number().int().positive() }).passthrough(),
    z.object({ type: z.literal("daily"), time: z.string() }).passthrough(),
    z.object({ type: z.literal("cron"), expr: z.string() }).passthrough()
  ])
  .or(z.object({ type: z.string() }).passthrough());

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
    latest_run: z.unknown().optional()
  })
  .passthrough();

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
    extras: z
      .object({
        reasoning: z.string().optional(),
        tools: z.array(z.record(z.unknown())).optional()
      })
      .nullable()
      .optional(),
    created_at: z.string()
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
    last_run: z.unknown().nullable().optional(),
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
    last_run: z.unknown().nullable().optional(),
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

export const ChatSseEventSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("accepted"), session_id: z.string(), message_id: z.number().optional() }).passthrough(),
    z.object({ type: z.literal("start"), session_id: z.string().optional(), message_id: z.number().optional() }).passthrough(),
    z.object({ type: z.literal("delta"), session_id: z.string().optional(), message_id: z.number().optional(), text: z.string().default("") }).passthrough(),
    z.object({ type: z.literal("done"), session_id: z.string().optional(), message_id: z.number().optional(), content: z.string().optional() }).passthrough(),
    z.object({ type: z.literal("error"), session_id: z.string().optional(), message_id: z.number().optional(), message: z.string() }).passthrough(),
    z.object({ type: z.literal("heartbeat") }).passthrough()
  ])
  .or(z.object({ type: z.string() }).passthrough());

export type Schedule = z.infer<typeof ScheduleSchema>;
export type ScheduleRun = z.infer<typeof ScheduleRunSchema>;
export type ChatSession = z.infer<typeof ChatSessionSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
export type FlowSummary = z.infer<typeof FlowSummarySchema>;
export type FlowDetail = z.infer<typeof FlowDetailSchema>;
export type ManualRunStatus = z.infer<typeof ManualRunStatusSchema>;
export type OutputFileEntry = z.infer<typeof OutputFileEntrySchema>;
export type OutputDirectory = z.infer<typeof OutputDirectorySchema>;
export type ChatSseEvent = z.infer<typeof ChatSseEventSchema>;
