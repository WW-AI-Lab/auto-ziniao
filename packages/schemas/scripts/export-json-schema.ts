import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { FlowDefinitionSchema } from "../src/flow.js";
import { FlowRuntimeEventSchema } from "../src/runtime-data.js";
import {
  ApiErrorResponseSchema,
  ChatAgentInfoSchema,
  ChatMessageSchema,
  ChatSessionSchema,
  ChatSseEventSchema,
  CreateFlowRequestSchema,
  CreateFlowResponseSchema,
  ExtractDetailSchema,
  FlowRunDetailSchema,
  FlowRunHistoryItemSchema,
  FlowDetailSchema,
  FlowSummarySchema,
  FlowTemplateResponseSchema,
  HealDetailSchema,
  HealEntrySchema,
  HealSummarySchema,
  ManualRunStatusSchema,
  OutputDirectorySchema,
  OutputFileEntrySchema,
  OutputPreviewSchema,
  OutputRefSchema,
  SaveExtractRequestSchema,
  ScheduleRunSchema,
  ScheduleSchema,
  WebAdminStatsSchema
} from "../src/webadmin.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const outputDir = path.join(packageRoot, "json-schema");

const schemas = [
  {
    file: "flow-definition.schema.json",
    rendered: `${JSON.stringify(
      zodToJsonSchema(FlowDefinitionSchema, {
        name: "FlowDefinition",
        $refStrategy: "none"
      }),
      null,
      2
    )}\n`
  },
  {
    file: "flow-runtime-event.schema.json",
    rendered: `${JSON.stringify(
      zodToJsonSchema(FlowRuntimeEventSchema, {
        name: "FlowRuntimeEvent",
        $refStrategy: "none"
      }),
      null,
      2
    )}\n`
  },
  {
    file: "webadmin-api.schema.json",
    rendered: `${JSON.stringify(
      zodToJsonSchema(
        z.object({
          schedule: ScheduleSchema,
          scheduleRun: ScheduleRunSchema,
          chatSession: ChatSessionSchema,
          chatMessage: ChatMessageSchema,
          flowSummary: FlowSummarySchema,
          flowDetail: FlowDetailSchema,
          createFlowRequest: CreateFlowRequestSchema,
          createFlowResponse: CreateFlowResponseSchema,
          saveExtractRequest: SaveExtractRequestSchema,
          extractDetail: ExtractDetailSchema,
          flowTemplateResponse: FlowTemplateResponseSchema,
          healSummary: HealSummarySchema,
          outputRef: OutputRefSchema,
          flowRunHistoryItem: FlowRunHistoryItemSchema,
          flowRunDetail: FlowRunDetailSchema,
          manualRunStatus: ManualRunStatusSchema,
          outputFileEntry: OutputFileEntrySchema,
          outputDirectory: OutputDirectorySchema,
          outputPreview: OutputPreviewSchema,
          healEntry: HealEntrySchema,
          healDetail: HealDetailSchema,
          webAdminStats: WebAdminStatsSchema,
          chatAgentInfo: ChatAgentInfoSchema,
          chatSseEvent: ChatSseEventSchema,
          apiErrorResponse: ApiErrorResponseSchema
        }),
        {
          name: "WebAdminApi",
          $refStrategy: "none"
        }
      ),
      null,
      2
    )}\n`
  }
];

if (process.argv.includes("--check")) {
  for (const item of schemas) {
    const outputFile = path.join(outputDir, item.file);
    if (!existsSync(outputFile)) {
      console.error(`JSON Schema 不存在: ${outputFile}`);
      process.exit(1);
    }
    const current = readFileSync(outputFile, "utf8");
    if (current !== item.rendered) {
      console.error(`JSON Schema 不是最新: ${outputFile}`);
      process.exit(1);
    }
    console.log(`JSON Schema 已是最新: ${outputFile}`);
  }
} else {
  mkdirSync(outputDir, { recursive: true });
  for (const item of schemas) {
    const outputFile = path.join(outputDir, item.file);
    writeFileSync(outputFile, item.rendered, "utf8");
    console.log(`已写入 JSON Schema: ${outputFile}`);
  }
}
