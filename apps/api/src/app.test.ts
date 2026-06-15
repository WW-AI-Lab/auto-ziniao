import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { createFlowRunner } from "./runner.js";
import { createScheduler } from "./scheduler.js";
import { createStorage } from "./storage.js";

describe("api app", () => {
  it("serves flow APIs, rejects invalid save, and runs local flow offline", async () => {
    const repo = createRepo();
    const app = await createTestApp(repo);
    const flows = await app.inject({ method: "GET", url: "/api/flows" });
    expect(flows.statusCode).toBe(200);
    expect(flows.json().items.map((item: { id: string }) => item.id)).toContain("local");
    expect(flows.json().items.map((item: { id: string }) => item.id)).not.toContain("_template");

    const detail = await app.inject({ method: "GET", url: "/api/flows/local" });
    expect(detail.statusCode).toBe(200);
    expect(JSON.parse(detail.json().content).id).toBe("local");

    const before = readFileSync(path.join(repo.root, "flows", "local.json"), "utf8");
    const invalid = await app.inject({
      method: "PUT",
      url: "/api/flows/local",
      payload: { content: "{bad" }
    });
    expect(invalid.statusCode).toBe(400);
    expect(readFileSync(path.join(repo.root, "flows", "local.json"), "utf8")).toBe(before);

    const run = await app.inject({
      method: "POST",
      url: "/api/flows/local/run",
      payload: { params: { greeting: "hi" } }
    });
    expect(run.statusCode).toBe(200);
    const token = run.json().token;
    await waitFor(() => app.inject({ method: "GET", url: `/api/flow-runs/${token}` }).then((r) => r.json().status !== "running"));
    const status = await app.inject({ method: "GET", url: `/api/flow-runs/${token}` });
    expect(status.json().status).toBe("success");
    await app.close();
  });

  it("protects output paths and exposes monitoring endpoints", async () => {
    const repo = createRepo();
    mkdirSync(path.join(repo.dataRoot, "output"), { recursive: true });
    writeFileSync(path.join(repo.dataRoot, "output", "result.json"), "{\"ok\":true}\n");
    writeFileSync(path.join(repo.dataRoot, "logs", "runs.jsonl"), `${JSON.stringify({ flow_id: "local", status: "success", timestamp: "t" })}\nnot-json\n`);
    writeFileSync(path.join(repo.root, "learnings", "heals.jsonl"), `${JSON.stringify({ heal_id: "h1", flow_id: "local", event: "triggered" })}\n`);
    const app = await createTestApp(repo);
    expect((await app.inject({ method: "GET", url: "/api/outputs?path=../../etc/passwd" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/outputs" })).json().files[0].name).toBe("result.json");
    expect((await app.inject({ method: "GET", url: "/api/outputs/preview?path=result.json" })).json().content).toContain("ok");
    expect((await app.inject({ method: "GET", url: "/api/runs" })).json().items).toHaveLength(1);
    const stats = (await app.inject({ method: "GET", url: "/api/stats" })).json();
    expect(stats.runs_total).toBe(1);
    expect(stats.runs_error).toBe(0);
    expect(stats.heals_total).toBe(1);
    expect(stats.flows[0].heal_count).toBe(1);
    expect(stats.chat_sessions).toBe(0);
    await app.close();
  });

  it("manages schedules and scheduler tick with temporary sqlite", async () => {
    const repo = createRepo();
    const storage = createStorage(path.join(repo.dataRoot, "webadmin.db"));
    const runner = createFlowRunner({
      repoRoot: repo.root,
      dataRoot: repo.dataRoot,
      sleeper: async () => undefined,
      clock: { now: () => new Date("2026-06-15T08:00:00.000Z") }
    });
    const app = await createApp({ config: { repoRoot: repo.root, dataRoot: repo.dataRoot }, storage, runner });
    const created = await app.inject({
      method: "POST",
      url: "/api/schedules",
      payload: { name: "任务", flow_id: "local", trigger: { type: "interval", minutes: 1 } }
    });
    expect(created.statusCode).toBe(200);
    const sid = created.json().id;
    expect((await app.inject({ method: "GET", url: "/api/schedules" })).json().items[0].id).toBe(sid);
    expect((await app.inject({ method: "POST", url: "/api/schedules", payload: { name: "bad", flow_id: "local", trigger: { type: "cron", expr: "0 8 * * MON#2" } } })).statusCode).toBe(400);

    storage.updateSchedule(sid, { next_run_at: "2026-06-15T07:59:00.000Z" });
    const scheduler = createScheduler({ storage, runner, clock: { now: () => new Date("2026-06-15T08:00:00.000Z") } });
    await scheduler.tick();
    expect(storage.listScheduleRuns(sid)).toHaveLength(1);
    expect(new Date(String(storage.getSchedule(sid)?.next_run_at)).getTime()).toBeGreaterThan(new Date("2026-06-15T08:00:00.000Z").getTime());
    await app.close();
  });

  it("handles chat SSE with mock agent runner and rejects concurrent sends", async () => {
    const repo = createRepo();
    const app = await createTestApp(repo, {
      agentRunner: {
        async run() {
          return { exitCode: 0, stdout: "收到" };
        }
      }
    });
    const session = await app.inject({ method: "POST", url: "/api/chat/sessions", payload: { title: "t" } });
    const sid = session.json().id;
    const response = await app.inject({ method: "POST", url: `/api/chat/sessions/${sid}/messages`, payload: { content: "你好" } });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("\"type\":\"accepted\"");
    expect(response.body).toContain("收到");
    const messages = await app.inject({ method: "GET", url: `/api/chat/sessions/${sid}/messages` });
    expect(messages.json().items).toHaveLength(2);
    await app.close();
  });

  it("persists chat runner failures without real agent CLI", async () => {
    const repo = createRepo();
    const app = await createTestApp(repo, {
      agentRunner: {
        async run() {
          return { exitCode: 2, stderr: "bad agent" };
        }
      }
    });
    const sid = (await app.inject({ method: "POST", url: "/api/chat/sessions", payload: { title: "t" } })).json().id;
    const response = await app.inject({ method: "POST", url: `/api/chat/sessions/${sid}/messages`, payload: { content: "你好" } });
    expect(response.body).toContain("\"type\":\"error\"");
    expect(response.body).toContain("bad agent");
    const messages = (await app.inject({ method: "GET", url: `/api/chat/sessions/${sid}/messages` })).json().items;
    expect(messages[1].status).toBe("failed");
    await app.close();
  });

  it("keeps API available when frontend dist is missing and serves dist when present", async () => {
    const missing = createRepo();
    const appMissing = await createTestApp(missing);
    expect((await appMissing.inject({ method: "GET", url: "/" })).json().message).toContain("前端构建产物缺失");
    await appMissing.close();

    const present = createRepo();
    const dist = path.join(present.root, "apps", "web", "dist");
    mkdirSync(dist, { recursive: true });
    writeFileSync(path.join(dist, "index.html"), "<html>ok</html>");
    const appPresent = await createTestApp(present);
    expect((await appPresent.inject({ method: "GET", url: "/" })).body).toContain("ok");
    expect((await appPresent.inject({ method: "GET", url: "/api/nope" })).statusCode).toBe(404);
    await appPresent.close();

    const injected = createRepo();
    const injectedDist = path.join(injected.root, "custom-frontend-dist");
    mkdirSync(injectedDist, { recursive: true });
    writeFileSync(path.join(injectedDist, "index.html"), "<html>injected</html>");
    const appInjected = await createTestApp(injected, { config: { frontendDist: injectedDist } });
    expect((await appInjected.inject({ method: "GET", url: "/" })).body).toContain("injected");
    await appInjected.close();
  });
});

function createRepo() {
  const root = mkdtempSync(path.join(tmpdir(), "ziniao-api-"));
  const dataRoot = path.join(root, "data");
  for (const dir of ["flows", "extracts", "learnings", "data/logs", "data/output"]) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  writeFileSync(path.join(root, "AGENTS.md"), "test");
  writeFileSync(path.join(root, "config.json"), JSON.stringify({
    heal: {
      agent: "mock",
      agents: { mock: { command: ["mock-agent", "{prompt}"], timeout_sec: 1 } }
    }
  }));
  writeFlow(root, "_template", { id: "__FLOW_ID__", name: "__FLOW_NAME__", steps: [{ id: "say", action: "print", message: "hello" }] });
  writeFlow(root, "local", {
    id: "local",
    name: "本地流程",
    version: 1,
    enabled: true,
    params: { greeting: "hello" },
    steps: [
      { id: "say", action: "print", message: "${params.greeting}" },
      { id: "save", action: "save_json", path: "local/result.json", data: { ok: true } }
    ]
  });
  return { root, dataRoot };
}

async function createTestApp(
  repo: { root: string; dataRoot: string },
  options: Partial<Parameters<typeof createApp>[0]> = {}
) {
  const { config, ...rest } = options;
  return createApp({
    config: { repoRoot: repo.root, dataRoot: repo.dataRoot, ...config },
    agentRunner: {
      async run() {
        return { exitCode: 0, stdout: "OK" };
      }
    },
    ...rest
  });
}

function writeFlow(root: string, id: string, value: unknown) {
  writeFileSync(path.join(root, "flows", `${id}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

async function waitFor(fn: () => Promise<boolean>) {
  const started = Date.now();
  while (Date.now() - started < 1000) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timeout waiting for condition");
}
