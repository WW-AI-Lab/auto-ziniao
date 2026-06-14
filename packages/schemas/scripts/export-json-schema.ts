import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { FlowDefinitionSchema } from "../src/flow.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const outputDir = path.join(packageRoot, "json-schema");
const outputFile = path.join(outputDir, "flow-definition.schema.json");

const schema = zodToJsonSchema(FlowDefinitionSchema, {
  name: "FlowDefinition",
  $refStrategy: "none"
});
const rendered = `${JSON.stringify(schema, null, 2)}\n`;

if (process.argv.includes("--check")) {
  if (!existsSync(outputFile)) {
    console.error(`JSON Schema 不存在: ${outputFile}`);
    process.exit(1);
  }
  const current = readFileSync(outputFile, "utf8");
  if (current !== rendered) {
    console.error(`JSON Schema 不是最新: ${outputFile}`);
    process.exit(1);
  }
  console.log(`JSON Schema 已是最新: ${outputFile}`);
} else {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputFile, rendered, "utf8");
  console.log(`已写入 JSON Schema: ${outputFile}`);
}
