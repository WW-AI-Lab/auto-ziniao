import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const forbiddenPackages = [
  "playwright",
  "selenium",
  "puppeteer",
  "browser-use"
];

const sourceRules: Array<{ label: string; pattern: RegExp }> = [
  { label: "Playwright import", pattern: /\bfrom\s+["']playwright["']|\brequire\(["']playwright["']\)/ },
  { label: "Selenium dependency", pattern: /\bselenium\b/i },
  { label: "Puppeteer dependency", pattern: /\bpuppeteer\b/i },
  { label: "browser-use dependency", pattern: /\bbrowser-use\b/i },
  { label: "webbrowser module", pattern: /\bwebbrowser\b/i },
  { label: "macOS open URL command", pattern: /\bopen\s+https?:\/\//i }
];

const directBridgeRules: Array<{ label: string; pattern: RegExp }> = [
  { label: "direct ZClaw port", pattern: /9481/ },
  { label: "direct ZClaw API key access", pattern: /ZCLAW_API_KEY|\.zclaw\/config\.json/ },
  {
    label: "direct ZClaw HTTP access",
    pattern: /\b(fetch|request|axios|http|https|urlopen)\b[\s\S]{0,120}\/zclaw\//
  }
];

function normalizePath(filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function isSecurityScan(filePath: string): boolean {
  return normalizePath(filePath) === "scripts/security-scan.ts";
}

function isAllowedZClawBridgeFile(filePath: string): boolean {
  return normalizePath(filePath).startsWith("packages/zclaw/src/");
}

function isSelfHealPackage(filePath: string): boolean {
  return normalizePath(filePath).startsWith("packages/self-heal/");
}

function isCliPackage(filePath: string): boolean {
  return normalizePath(filePath).startsWith("packages/cli/");
}

function isWebAdminApiApp(filePath: string): boolean {
  return normalizePath(filePath).startsWith("apps/api/");
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

function walk(dirPath: string): string[] {
  if (!existsSync(dirPath)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", ".git"].includes(entry.name)) {
        continue;
      }
      out.push(...walk(full));
    } else if (/\.(ts|tsx|js|json)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function packageDeps(pkg: Record<string, unknown>): string[] {
  const keys = ["dependencies", "devDependencies", "optionalDependencies"];
  return keys.flatMap((key) =>
    Object.keys((pkg[key] as Record<string, unknown> | undefined) ?? {})
  );
}

const failures: string[] = [];

for (const packageFile of [
  path.join(repoRoot, "package.json"),
  ...walk(path.join(repoRoot, "packages")).filter((file) => file.endsWith("package.json")),
  ...walk(path.join(repoRoot, "apps")).filter((file) => file.endsWith("package.json"))
]) {
  const deps = packageDeps(readJson(packageFile));
  for (const forbidden of forbiddenPackages) {
    if (deps.includes(forbidden)) {
      failures.push(`${packageFile}: 禁止依赖 ${forbidden}`);
    }
  }
  if (normalizePath(packageFile) === "packages/self-heal/package.json" && deps.includes("@ww-ai-lab/auto-ziniao-zclaw")) {
    failures.push(`${packageFile}: packages/self-heal 禁止依赖 @ww-ai-lab/auto-ziniao-zclaw`);
  }
  if (normalizePath(packageFile) === "packages/cli/package.json" && deps.includes("@ww-ai-lab/auto-ziniao-zclaw")) {
    failures.push(`${packageFile}: packages/cli 禁止直接依赖 @ww-ai-lab/auto-ziniao-zclaw`);
  }
  if (normalizePath(packageFile) === "apps/api/package.json" && deps.includes("@ww-ai-lab/auto-ziniao-zclaw")) {
    failures.push(`${packageFile}: apps/api 禁止直接依赖 @ww-ai-lab/auto-ziniao-zclaw`);
  }
}

for (const filePath of [
  ...walk(path.join(repoRoot, "packages")),
  ...walk(path.join(repoRoot, "apps")),
  ...walk(path.join(repoRoot, "scripts"))
]) {
  if (isSecurityScan(filePath)) {
    continue;
  }
  const text = readFileSync(filePath, "utf8");
  if (isSelfHealPackage(filePath) && text.includes("@ww-ai-lab/auto-ziniao-zclaw")) {
    failures.push(`${filePath}: packages/self-heal 禁止 import @ww-ai-lab/auto-ziniao-zclaw`);
  }
  if (isCliPackage(filePath) && text.includes("@ww-ai-lab/auto-ziniao-zclaw")) {
    failures.push(`${filePath}: packages/cli 禁止 import @ww-ai-lab/auto-ziniao-zclaw`);
  }
  if (isWebAdminApiApp(filePath) && text.includes("@ww-ai-lab/auto-ziniao-zclaw")) {
    failures.push(`${filePath}: apps/api 禁止 import @ww-ai-lab/auto-ziniao-zclaw`);
  }
  for (const rule of sourceRules) {
    if (rule.pattern.test(text)) {
      failures.push(`${filePath}: ${rule.label}`);
    }
  }
  if (isAllowedZClawBridgeFile(filePath)) {
    continue;
  }
  for (const rule of directBridgeRules) {
    if (rule.pattern.test(text)) {
      failures.push(`${filePath}: ${rule.label}`);
    }
  }
}

if (failures.length > 0) {
  console.error("== Security scan failed ==");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("== Security scan ok ==");
