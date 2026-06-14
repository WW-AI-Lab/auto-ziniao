import { z } from "zod";

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

export type Schedule = z.infer<typeof ScheduleSchema>;
export type ScheduleRun = z.infer<typeof ScheduleRunSchema>;
export type ChatSession = z.infer<typeof ChatSessionSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
