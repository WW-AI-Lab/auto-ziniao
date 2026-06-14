import { z } from "zod";

export const RunStatusSchema = z.enum(["success", "failed", "error", "exhausted"]);

export const RunLogEntrySchema = z
  .object({
    flow_id: z.string(),
    timestamp: z.string(),
    status: RunStatusSchema.or(z.string()),
    duration_ms: z.number().optional(),
    error: z.string().nullable().optional(),
    params: z.record(z.string()).optional().default({}),
    data_summary: z.record(z.string()).optional().default({})
  })
  .passthrough();

export const HealEventSchema = z
  .object({
    timestamp: z.string().optional(),
    event: z.string().optional(),
    heal_id: z.string().optional(),
    flow_id: z.string().optional(),
    step_id: z.string().optional(),
    error_type: z.string().optional(),
    reason: z.string().optional(),
    agent: z.string().optional(),
    session_key: z.string().optional(),
    prompt_path: z.string().optional(),
    heal_log_path: z.string().optional(),
    cli_exit_code: z.number().optional(),
    cli_stderr: z.string().optional()
  })
  .passthrough();

export const HealContextSchema = z
  .object({
    heal_id: z.string(),
    flow_id: z.string(),
    flow_name: z.string().optional(),
    step_id: z.string().optional(),
    tool_name: z.string().optional(),
    error_type: z.string().optional(),
    error: z.string().optional(),
    timestamp: z.string(),
    params: z.record(z.unknown()).optional().default({}),
    context: z.record(z.unknown()).optional().default({}),
    prompt_path: z.string().optional(),
    failed_args: z.unknown().optional(),
    screenshot: z.string().optional()
  })
  .passthrough();

export const KnownIssueSchema = z
  .object({
    pattern: z.string(),
    flow_id: z.string().optional(),
    step_id: z.string().optional(),
    root_cause: z.string().optional(),
    fix: z.string().optional(),
    fix_applied_at: z.string().optional(),
    resolved: z.boolean().default(false)
  })
  .passthrough();

export const KnownIssuesFileSchema = z
  .object({
    _comment: z.string().optional(),
    issues: z.array(KnownIssueSchema).default([])
  })
  .passthrough();

export type RunLogEntry = z.infer<typeof RunLogEntrySchema>;
export type HealEvent = z.infer<typeof HealEventSchema>;
export type HealContext = z.infer<typeof HealContextSchema>;
export type KnownIssue = z.infer<typeof KnownIssueSchema>;
export type KnownIssuesFile = z.infer<typeof KnownIssuesFileSchema>;
