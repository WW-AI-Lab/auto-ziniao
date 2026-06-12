# OpenClaw gateway 真机探测结论（任务 1.1）

探测时间：2026-06-12，CLI/Gateway 版本：2026.5.28 (e932160)。源码参考：`~/go/src/openclaw/`。

## Gateway 运行形态

- LaunchAgent 常驻：`ws://127.0.0.1:18789`，仅回环监听（bind=loopback）。
- `http://127.0.0.1:18789/` 是 Control UI（SPA），未知路径回退返回 index.html —— **探测可达性不能用 GET 返回 200 判断**。
- 鉴权：`~/.openclaw/openclaw.json` 中 `gateway.auth.mode: "token"`，token 在 `gateway.auth.token`，HTTP 端点用 `Authorization: Bearer <token>`。

## HTTP API（OpenAI 兼容层）

源码 `src/gateway/server-http.ts` / `openai-http.ts` 确认存在以下 HTTP 端点：

| 端点 | 说明 |
|------|------|
| `POST /v1/chat/completions` | OpenAI 兼容 chat，支持 `stream: true`（SSE） |
| `GET /v1/models` | 模型列表 |
| `POST /v1/responses` | OpenResponses 端点 |
| `POST /tools/invoke` | 工具调用 |

关键限制：**默认关闭**。仅当 `gateway.http.endpoints.chatCompletions.enabled = true`（`server.impl.ts:493`）时才启用；本机配置缺省 → 实测 `POST /v1/chat/completions` 返回 404。

会话映射：请求体 `user` 字段经 `resolveGatewayRequestContext` 解析为 gateway 侧 `sessionKey`（`openai-http.ts:891,963`），可用 webadmin 会话 id 作为 `user` 实现多会话隔离。

## CLI 通道

`openclaw agent --session-key <key> -m <text> --json [--timeout N]`：经 gateway 跑一个 agent turn，JSON 输出回复，**不带 `--deliver` 即不投递到任何频道**；会话记忆由 gateway 按 session-key 维护（多轮对话无需客户端拼接历史）。

## 适配器实现决策

1. `OpenClawGatewayAdapter`：`POST /v1/chat/completions`（Bearer token 读 `~/.openclaw/openclaw.json`），`stream: true` SSE 转发；`user` 传 webadmin 会话 key。可达性探测 = 带鉴权的小请求，**404 / 连接拒绝 → 视为不可用**，自动回退 CLI。本机当前该端点未启用，回退 CLI 即生效路径。不擅自修改用户的 `openclaw.json`（如用户想启用 gateway 直连，文档说明加 `gateway.http.endpoints.chatCompletions.enabled: true` 后 webadmin 自动切换）。
2. `CliAgentAdapter`：agent 清单与命令模板取 `config.json` `heal.agents`。chat 场景对模板做去投递处理：移除 `--deliver` 与 `--channel <值>`，openclaw 追加 `--json`；`{session_key}` 填 webadmin 会话 key（openclaw 多轮记忆生效）；`{prompt}` 填当前消息。claude / cursor-agent 模板原样使用（无投递参数；CLI 无服务端会话，v1 仅发送当前消息，限制写入文档）。
3. CLI 无原生流式 → 子进程完成后整段下发 + 完成事件（符合 spec agent-chat 的降级约定）。
