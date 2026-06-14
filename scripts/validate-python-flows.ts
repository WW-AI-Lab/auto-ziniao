import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const flowsDir = path.join(repoRoot, "flows");
const flowIds = readdirSync(flowsDir)
  .filter((name) => name.endsWith(".json") && !name.startsWith("_"))
  .map((name) => name.replace(/\.json$/, ""))
  .sort((a, b) => a.localeCompare(b));

console.log("== Python flow validate ==");
let failed = false;
for (const flowId of flowIds) {
  const result = spawnSync("python3", ["manager.py", "validate", flowId], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  const output = `${result.stdout}${result.stderr}`.trim();
  if (result.status !== 0) {
    failed = true;
    console.error(`[failed] ${flowId}`);
    if (output) {
      console.error(output);
    }
  } else {
    console.log(`[ok] ${flowId}`);
  }
}

if (failed) {
  process.exit(1);
}
