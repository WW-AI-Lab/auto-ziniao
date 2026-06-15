import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { getWebAdminChatConfig } from "./config.js";
import { createFlowRunner } from "./runner.js";
import { createScheduler } from "./scheduler.js";
import { createStorage } from "./storage.js";

describe("api app", () => {
  it("discovers built-in chat agents and applies config overlays", () => {
    const repo = createRepo();
    const cfg = getWebAdminChatConfig(repo.root, {
      commandLocator(command) {
        return command === "codex" ? "/mock/bin/codex" : command === "claude" ? "/mock/bin/claude" : null;
      }
    });
    expect(cfg.defaultAgent).toBe("openclaw");
    expect(cfg.agents.openclaw).toMatchObject({ type: "openclaw-gateway", available: true, source: "discovered" });
    expect(cfg.agents.codex).toMatchObject({ type: "codex-cli", available: true, command: expect.arrayContaining(["/mock/bin/codex", "exec"]) });
    expect(cfg.agents.claude).toMatchObject({ type: "claude-code-cli", available: true, command: expect.arrayContaining(["/mock/bin/claude", "-p"]) });

    writeFileSync(path.join(repo.root, "config.json"), JSON.stringify({
      webadmin: {
        chat: {
          agent: "codex",
          agents: {
            codex: { label: "Codex 本机", timeout_sec: 123 },
            claude: { disabled: true }
          }
        }
      }
    }));
    const overlaid = getWebAdminChatConfig(repo.root, {
      commandLocator(command) {
        return command === "codex" ? "/mock/bin/codex" : command === "claude" ? "/mock/bin/claude" : null;
      }
    });
    expect(overlaid.defaultAgent).toBe("codex");
    expect(overlaid.agents.codex).toMatchObject({ label: "Codex 本机", timeoutSec: 123, source: "overlay" });
    expect(overlaid.agents.claude.available).toBe(false);
    expect(overlaid.agents.claude.diagnostic?.code).toBe("disabled");

    const missingRepo = createRepo();
    writeFileSync(path.join(missingRepo.root, "config.json"), JSON.stringify({
      webadmin: { chat: { agents: { codex: { label: "Codex 本机", timeout_sec: 123 } } } }
    }));
    const missing = getWebAdminChatConfig(missingRepo.root, { commandLocator: () => null });
    expect(missing.agents.codex).toMatchObject({
      label: "Codex 本机",
      available: false,
      diagnostic: { code: "command_missing" }
    });
  });

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
    expect(status.json().run_id).toBeTruthy();
    const runDetail = await app.inject({ method: "GET", url: `/api/runs/${status.json().run_id}` });
    expect(runDetail.statusCode).toBe(200);
    expect(String(runDetail.json().data_summary.save)).toContain("file:");
    await app.close();
  });

  it("creates flows from API-owned template and manages extracts offline", async () => {
    const repo = createRepo();
    const app = await createTestApp(repo);

    const template = await app.inject({ method: "GET", url: "/api/flows/template" });
    expect(template.statusCode).toBe(200);
    expect(template.json().content).toContain("__FLOW_ID__");

    const created = await app.inject({
      method: "POST",
      url: "/api/flows",
      payload: { id: "sample_flow", name: "样例流程" }
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().id).toBe("sample_flow");
    expect(readFileSync(path.join(repo.root, "flows", "sample_flow.json"), "utf8")).toContain("\"name\": \"样例流程\"");

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/flows",
      payload: { id: "sample_flow", name: "重复" }
    });
    expect(duplicate.statusCode).toBe(409);

    const invalidContent = await app.inject({
      method: "POST",
      url: "/api/flows",
      payload: { id: "bad_flow", content: "{\"id\":\"other\",\"steps\":[]}" }
    });
    expect(invalidContent.statusCode).toBe(400);
    expect(existsSync(path.join(repo.root, "flows", "bad_flow.json"))).toBe(false);

    const savedExtract = await app.inject({
      method: "PUT",
      url: "/api/extracts/sample.js",
      payload: { content: "(() => JSON.stringify({ ok: true }))();" }
    });
    expect(savedExtract.statusCode).toBe(200);
    expect(savedExtract.json().path).toBe("extracts/sample.js");

    const extract = await app.inject({ method: "GET", url: "/api/extracts/sample.js" });
    expect(extract.statusCode).toBe(200);
    expect(extract.json().exists).toBe(true);
    expect(extract.json().content).toContain("JSON.stringify");

    expect((await app.inject({ method: "GET", url: "/api/extracts/%2e%2e/outside.js" })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await app.inject({ method: "PUT", url: "/api/extracts/%2e%2e/outside.js", payload: { content: "bad" } })).statusCode).toBeGreaterThanOrEqual(400);
    expect(existsSync(path.join(repo.root, "outside.js"))).toBe(false);
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
    expect((await app.inject({ method: "GET", url: "/api/runs?flow_id=local&status=success" })).json().items).toHaveLength(1);
    const historicalId = (await app.inject({ method: "GET", url: "/api/flows/local/runs" })).json().items[0].run_id;
    const historicalDetail = await app.inject({ method: "GET", url: `/api/runs/${historicalId}` });
    expect(historicalDetail.statusCode).toBe(200);
    expect(historicalDetail.json().detail_available).toBe(false);
    const stats = (await app.inject({ method: "GET", url: "/api/stats" })).json();
    expect(stats.runs_total).toBe(1);
    expect(stats.runs_error).toBe(0);
    expect(stats.heals_total).toBe(1);
    expect(stats.flows[0].heal_count).toBe(1);
    expect(stats.chat_sessions).toBe(0);
    await app.close();
  });

  it("exposes failed run detail with mock self-heal metadata", async () => {
    const repo = createRepo();
    const app = await createTestApp(repo, {
      agentRunner: {
        async run() {
          return { exitCode: 0, stdout: "healed" };
        }
      }
    });
    const run = await app.inject({
      method: "POST",
      url: "/api/flows/failing/run",
      payload: { params: { store_name: "demo" } }
    });
    expect(run.statusCode).toBe(200);
    const token = run.json().token;
    await waitFor(() => app.inject({ method: "GET", url: `/api/flow-runs/${token}` }).then((r) => r.json().status !== "running"));
    const status = (await app.inject({ method: "GET", url: `/api/flow-runs/${token}` })).json();
    expect(status.status).toBe("failed");
    expect(status.heal_summary.status).toBe("success");

    const history = (await app.inject({ method: "GET", url: "/api/flows/failing/runs?status=failed" })).json();
    expect(history.items[0].run_id).toBe(status.run_id);
    const detail = (await app.inject({ method: "GET", url: `/api/runs/${status.run_id}` })).json();
    expect(detail.failed_step.step_id).toBe("fail");
    expect(detail.heal_summary.heal_id).toBeTruthy();
    expect(detail.heal_events[0].status).toBe("success");
    expect(detail.heal_context.flow_id).toBe("failing");
    await app.close();
  });

  it("exposes self-heal agent delivery failures without replacing the flow error", async () => {
    const repo = createRepo();
    const stderr = "Delivering to Feishu requires target";
    const app = await createTestApp(repo, {
      agentRunner: {
        async run() {
          return { exitCode: 1, stderr };
        }
      }
    });
    const run = await app.inject({
      method: "POST",
      url: "/api/flows/failing/run",
      payload: { params: { store_name: "demo" } }
    });
    expect(run.statusCode).toBe(200);
    const token = run.json().token;
    await waitFor(() => app.inject({ method: "GET", url: `/api/flow-runs/${token}` }).then((r) => r.json().status !== "running"));
    const status = (await app.inject({ method: "GET", url: `/api/flow-runs/${token}` })).json();
    expect(status.status).toBe("failed");
    expect(status.error).toBe("selector changed");
    expect(status.heal_summary.status).toBe("failed");
    expect(status.heal_summary.cli_exit_code).toBe(1);
    expect(status.heal_summary.cli_stderr).toBe(stderr);
    expect(status.heal_summary.error).toBe(stderr);

    const detail = (await app.inject({ method: "GET", url: `/api/runs/${status.run_id}` })).json();
    expect(detail.error).toBe("selector changed");
    expect(detail.heal_summary.cli_exit_code).toBe(1);
    expect(detail.heal_summary.cli_stderr).toBe(stderr);
    expect(detail.heal_events[0].cli_stderr).toBe(stderr);
    await app.close();
  });

  it("filters and paginates unified run history", async () => {
    const repo = createRepo();
    const app = await createTestApp(repo);
    const tokens: string[] = [];
    for (let i = 0; i < 2; i++) {
      const run = await app.inject({
        method: "POST",
        url: "/api/flows/local/run",
        payload: { params: { greeting: String(i) } }
      });
      tokens.push(run.json().token);
      await waitFor(() =>
        app.inject({ method: "GET", url: `/api/flow-runs/${run.json().token}` }).then((r) => r.json().status !== "running")
      );
    }

    const all = await app.inject({ method: "GET", url: "/api/runs?flow_id=local" });
    expect(all.json().total).toBeGreaterThanOrEqual(2);

    const successOnly = await app.inject({ method: "GET", url: "/api/runs?flow_id=local&status=success" });
    expect(successOnly.json().items.every((item: { status: string }) => item.status === "success")).toBe(true);

    const page = await app.inject({ method: "GET", url: "/api/runs?flow_id=local&limit=1&offset=0" });
    expect(page.json().items).toHaveLength(1);
    expect(page.json().total).toBeGreaterThanOrEqual(2);
    await app.close();
  });

  it("keeps run detail available when heal files are missing", async () => {
    const repo = createRepo();
    const storage = createStorage(path.join(repo.dataRoot, "webadmin.db"));
    const run = storage.createFlowRun({
      run_id: "run_missing_heal",
      source: "manual",
      flow_id: "local",
      status: "failed",
      started_at: "2026-06-15T00:00:00.000Z"
    });
    storage.updateFlowRun(run.run_id, {
      status: "failed",
      finished_at: "2026-06-15T00:00:01.000Z",
      error: "missing context",
      heal_summary: { status: "failed", heal_id: "heal_missing", error: "context gone" }
    });
    writeFileSync(
      path.join(repo.root, "learnings", "heals.jsonl"),
      `${JSON.stringify({
        event: "triggered",
        status: "failed",
        heal_id: "heal_missing",
        flow_id: "local",
        cli_exit_code: 1,
        cli_stderr: "delivery failed"
      })}\n`
    );
    const app = await createTestApp(repo, { storage });
    const detail = await app.inject({ method: "GET", url: "/api/runs/run_missing_heal" });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().heal_summary.context_available).toBe(false);
    expect(detail.json().heal_summary.cli_exit_code).toBe(1);
    expect(detail.json().heal_summary.cli_stderr).toBe("delivery failed");
    await app.close();
  });

  it("manages schedules and scheduler tick with temporary sqlite", async () => {
    const repo = createRepo();
    const storage = createStorage(path.join(repo.dataRoot, "webadmin.db"));
    const runner = createFlowRunner({
      repoRoot: repo.root,
      dataRoot: repo.dataRoot,
      storage,
      agentRunner: { async run() { return { exitCode: 0, stdout: "OK" }; } },
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
    const scheduleRuns = storage.listScheduleRuns(sid);
    expect(scheduleRuns).toHaveLength(1);
    expect(scheduleRuns[0].run_id).toBeTruthy();
    const scheduleHistory = await app.inject({ method: "GET", url: `/api/schedules/${sid}/runs` });
    expect(scheduleHistory.json().items[0].run_id).toBe(scheduleRuns[0].run_id);
    const runDetail = await app.inject({ method: "GET", url: `/api/runs/${scheduleRuns[0].run_id}` });
    expect(runDetail.statusCode).toBe(200);
    expect(new Date(String(storage.getSchedule(sid)?.next_run_at)).getTime()).toBeGreaterThan(new Date("2026-06-15T08:00:00.000Z").getTime());

    const busy = storage.createSchedule({
      name: "busy",
      flow_id: "local",
      trigger: { type: "interval", minutes: 1 },
      next_run_at: "2026-06-15T07:59:00.000Z"
    });
    const skippedScheduler = createScheduler({
      storage,
      runner: {
        execute: async () => ({ status: "skipped", exit_code: null, duration_ms: 0, error: "busy" }),
        isRunning: () => true,
        runs: new Map(),
        start: () => ({ token: "t", run_id: "run_t", flow_id: "local", status: "running" }),
        get: () => null
      } as unknown as ReturnType<typeof createFlowRunner>,
      clock: { now: () => new Date("2026-06-15T08:00:00.000Z") }
    });
    await skippedScheduler.tick();
    expect(storage.listScheduleRuns(busy.id)[0].status).toBe("skipped");
    await app.close();
  });

  it("handles chat SSE with mock Gateway chat client and rejects concurrent sends", async () => {
    const repo = createRepo();
    const app = await createTestApp(repo, {
      chatClient: {
        async sendChat() {
          return {
            text: "收到",
            reasoning: "先理解用户问题",
            tools: [{
              name: "query_orders",
              status: "success",
              args_summary: "store=demo",
              result_summary: "2 rows"
            }],
            a2ui: [{
              type: "table",
              title: "订单",
              columns: ["id", "status"],
              rows: [{ id: "o1", status: "paid" }]
            }]
          };
        }
      }
    });
    const session = await app.inject({ method: "POST", url: "/api/chat/sessions", payload: { title: "t" } });
    const sid = session.json().id;
    const response = await app.inject({ method: "POST", url: `/api/chat/sessions/${sid}/messages`, payload: { content: "你好" } });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("\"type\":\"accepted\"");
    expect(response.body).toContain("\"type\":\"reasoning_delta\"");
    expect(response.body).toContain("\"type\":\"tool_call\"");
    expect(response.body).toContain("\"type\":\"a2ui\"");
    expect(response.body).toContain("收到");
    const messages = await app.inject({ method: "GET", url: `/api/chat/sessions/${sid}/messages` });
    const items = messages.json().items;
    expect(items).toHaveLength(2);
    expect(items[0].extras).toBeNull();
    expect(items[1].extras.reasoning).toBe("先理解用户问题");
    expect(items[1].extras.tools[0]).toMatchObject({ name: "query_orders", status: "success" });
    expect(items[1].extras.a2ui[0]).toMatchObject({ type: "table", title: "订单" });
    await app.close();
  });

  it("uses WebAdmin OpenClaw Gateway config for chat without Agent CLI delivery", async () => {
    const repo = createRepo();
    writeFileSync(path.join(repo.root, "config.json"), JSON.stringify({
      webadmin: {
        chat: {
          agent: "openclaw",
          agents: {
            openclaw: {
              type: "openclaw-gateway",
              gateway_url: "ws://127.0.0.1:18789",
              agent_id: "main",
              timeout_sec: 320,
              session_key_prefix: "auto-ziniao-webadmin:"
            }
          }
        }
      },
      heal: {
        agent: "openclaw",
        agents: {
          openclaw: {
            command: ["openclaw", "agent", "--deliver", "--channel", "feishu"],
            timeout_sec: 320
          }
        }
      }
    }));
    let chatInput: unknown = null;
    let agentRunnerCalled = false;
    const app = await createTestApp(repo, {
      chatClient: {
        async sendChat(input) {
          chatInput = input;
          return { text: "收到", runId: "run_1" };
        }
      },
      agentRunner: {
        async run() {
          agentRunnerCalled = true;
          return { exitCode: 1, stderr: "should not run" };
        }
      }
    });
    const sid = (await app.inject({ method: "POST", url: "/api/chat/sessions", payload: { title: "t" } })).json().id;
    await app.inject({ method: "POST", url: `/api/chat/sessions/${sid}/messages`, payload: { content: "你好" } });
    expect(agentRunnerCalled).toBe(false);
    expect(chatInput).toMatchObject({
      agentName: "openclaw",
      sessionId: sid,
      content: "你好",
      agent: {
        gatewayUrl: "ws://127.0.0.1:18789",
        agentId: "main",
        timeoutSec: 320,
        sessionKeyPrefix: "auto-ziniao-webadmin:"
      }
    });
    await app.close();
  });

  it("persists Gateway chat failures without Agent CLI fallback", async () => {
    const repo = createRepo();
    let agentRunnerCalled = false;
    const app = await createTestApp(repo, {
      chatClient: {
        async sendChat() {
          throw Object.assign(new Error("OpenClaw Gateway RPC failed"), {
            reasoning: "已连接 Gateway，等待工具返回时失败",
            tools: [{ name: "gateway_agent", status: "failed", error: "RPC failed" }]
          });
        }
      },
      agentRunner: {
        async run() {
          agentRunnerCalled = true;
          return { exitCode: 0, stdout: "fallback" };
        }
      }
    });
    const sid = (await app.inject({ method: "POST", url: "/api/chat/sessions", payload: { title: "t" } })).json().id;
    const response = await app.inject({ method: "POST", url: `/api/chat/sessions/${sid}/messages`, payload: { content: "你好" } });
    expect(response.body).toContain("\"type\":\"error\"");
    expect(response.body).toContain("\"type\":\"reasoning_delta\"");
    expect(response.body).toContain("\"type\":\"tool_call\"");
    expect(response.body).toContain("OpenClaw Gateway RPC failed");
    expect(agentRunnerCalled).toBe(false);
    const messages = (await app.inject({ method: "GET", url: `/api/chat/sessions/${sid}/messages` })).json().items;
    expect(messages[1].status).toBe("failed");
    expect(messages[1].extras.reasoning).toContain("等待工具返回");
    expect(messages[1].extras.tools[0]).toMatchObject({ name: "gateway_agent", status: "failed" });
    await app.close();
  });

  it("exposes discovered chat agent metadata without leaking commands", async () => {
    const repo = createRepo();
    writeFileSync(path.join(repo.root, "config.json"), JSON.stringify({
      webadmin: {
        chat: {
          agents: {
            codex: {
              label: "Codex Secret",
              token: "secret-token",
              token_path: "/Users/example/.secret/token",
              command: ["/secret/bin/codex", "{prompt}"]
            }
          }
        }
      },
      heal: {
        agent: "mock",
        agents: { mock: { command: ["mock-agent", "{prompt}"], timeout_sec: 1 } }
      }
    }));
    const app = await createTestApp(repo, {
      commandLocator(command) {
        return command === "claude" ? "/mock/bin/claude" : null;
      }
    });
    const response = await app.inject({ method: "GET", url: "/api/chat/agents" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.default).toBe("openclaw");
    expect(body.items.map((item: { name: string }) => item.name)).toEqual(expect.arrayContaining(["openclaw", "codex", "claude"]));
    expect(body.items.find((item: { name: string }) => item.name === "codex")).toMatchObject({
      type: "codex-cli",
      label: "Codex Secret",
      available: false,
      source: "overlay",
      diagnostic: { code: "command_missing", message: "未找到已配置的 Agent 命令" }
    });
    expect(JSON.stringify(body)).not.toContain("/mock/bin/codex");
    expect(JSON.stringify(body)).not.toContain("/secret/bin/codex");
    expect(JSON.stringify(body)).not.toContain("secret-token");
    expect(JSON.stringify(body)).not.toContain("/Users/example/.secret/token");
    expect(JSON.stringify(body)).not.toContain("\"command\"");
    await app.close();
  });

  it("uses chat default preference for new sessions and falls back when unavailable", async () => {
    const repo = createRepo();
    const app = await createTestApp(repo, {
      commandLocator(command) {
        return command === "codex" ? "/mock/bin/codex" : null;
      }
    });
    const pref = await app.inject({
      method: "PUT",
      url: "/api/chat/preferences",
      payload: { default_agent: "codex" }
    });
    expect(pref.statusCode).toBe(200);
    const session = await app.inject({ method: "POST", url: "/api/chat/sessions", payload: { title: "pref" } });
    expect(session.json().agent).toBe("codex");
    await app.close();

    const fallback = await createTestApp(repo, { commandLocator: () => null });
    const fallbackSession = await fallback.inject({ method: "POST", url: "/api/chat/sessions", payload: { title: "fallback" } });
    expect(fallbackSession.json().agent).toBe("openclaw");
    await fallback.close();
  });

  it("sends chat through codex CLI adapter and keeps failures isolated", async () => {
    const repo = createRepo();
    const app = await createTestApp(repo, {
      commandLocator(command) {
        return command === "codex" ? "/mock/bin/codex" : null;
      },
      chatCommandRunner: async ({ command }) => {
        expect(command).toEqual(expect.arrayContaining(["/mock/bin/codex", "exec", "你好"]));
        return { exitCode: 0, stdout: "codex ok" };
      },
      chatClient: {
        async sendChat() {
          throw new Error("gateway should not run");
        }
      }
    });
    const sid = (await app.inject({ method: "POST", url: "/api/chat/sessions", payload: { title: "codex", agent: "codex" } })).json().id;
    const response = await app.inject({ method: "POST", url: `/api/chat/sessions/${sid}/messages`, payload: { content: "你好" } });
    expect(response.body).toContain("codex ok");
    const messages = (await app.inject({ method: "GET", url: `/api/chat/sessions/${sid}/messages` })).json().items;
    expect(messages[1]).toMatchObject({ status: "done", content: "codex ok" });
    expect(messages[1].extras).toMatchObject({ agent: "codex", agent_type: "codex-cli" });
    await app.close();

    const failed = await createTestApp(repo, {
      commandLocator(command) {
        return command === "codex" ? "/mock/bin/codex" : null;
      },
      chatCommandRunner: async () => ({ exitCode: 2, stderr: "bad codex" })
    });
    const failedSid = (await failed.inject({ method: "POST", url: "/api/chat/sessions", payload: { title: "codex", agent: "codex" } })).json().id;
    const failedResponse = await failed.inject({ method: "POST", url: `/api/chat/sessions/${failedSid}/messages`, payload: { content: "你好" } });
    expect(failedResponse.body).toContain("\"type\":\"error\"");
    expect(failedResponse.body).toContain("bad codex");
    const failedMessages = (await failed.inject({ method: "GET", url: `/api/chat/sessions/${failedSid}/messages` })).json().items;
    expect(failedMessages[1]).toMatchObject({ status: "failed" });
    expect(failedMessages[1].extras.diagnostic).toMatchObject({ code: "command_failed", cli_exit_code: 2 });
    await failed.close();
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
  writeFlow(root, "failing", {
    id: "failing",
    name: "失败流程",
    version: 1,
    enabled: true,
    params: { store_name: "" },
    steps: [
      { id: "fail", action: "fail", message: "selector changed", on_fail: { action: "heal", context: "extract_failed" } }
    ],
    heal: { hints: "测试失败流程" }
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
    chatClient: {
      async sendChat() {
        return { text: "OK" };
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
