# agent-chat — Agent 对话能力

## ADDED Requirements

### Requirement: 会话管理
系统 SHALL 提供 chat 会话的创建、列表、查看与删除 API。会话及消息 MUST 持久化到 SQLite（`chat_sessions`、`chat_messages` 表），服务重启后历史会话可继续查看。

#### Scenario: 创建并列出会话
- **WHEN** 客户端 `POST /api/chat/sessions` 创建会话后请求 `GET /api/chat/sessions`
- **THEN** 列表包含新会话，含 id、标题、agent 类型、创建/更新时间

#### Scenario: 查看历史消息
- **WHEN** 服务重启后客户端请求 `GET /api/chat/sessions/<id>/messages`
- **THEN** 返回该会话全部历史消息（按时间排序，含角色 user/assistant 与状态）

### Requirement: Agent 适配层
系统 SHALL 通过适配器统一对接两类 Agent 后端：OpenClaw gateway（HTTP）与 `config.json` `heal.agents` 中配置的 agent CLI（subprocess）。可用 agent 清单 MUST 来源于 `config.json`，不得另建重复配置。系统 SHALL 在启动或首次使用时探测 OpenClaw gateway 可达性，不可达时自动回退到 CLI 适配器。

#### Scenario: gateway 可达
- **WHEN** OpenClaw gateway 在本机可达且用户选择 openclaw agent 发送消息
- **THEN** 消息经 gateway HTTP 接口发送，回复以流式（如 gateway 支持）下发给前端

#### Scenario: gateway 不可达自动回退
- **WHEN** OpenClaw gateway 探测失败且用户选择 openclaw agent 发送消息
- **THEN** 系统按 `config.json` 中 openclaw 的命令模板以 subprocess 方式调用 CLI，正常返回回复，不报错中断

#### Scenario: 选择其他 agent CLI
- **WHEN** 用户在前端选择 `claude` 或 `cursor-agent` 发送消息
- **THEN** 系统按对应命令模板调用 CLI 并返回回复

### Requirement: SSE 流式回包
发送消息 API SHALL 以 SSE（Server-Sent Events）向前端下发回复事件流，事件类型至少包含增量内容、完成、错误三类。对不支持流式的 CLI 适配器，系统 SHALL 在子进程完成后将整段回复下发并发送完成事件。SSE 连接 SHALL 定期发送心跳注释行防止空闲断连。

#### Scenario: 流式接收回复
- **WHEN** 前端 `POST /api/chat/sessions/<id>/messages` 发送消息并以 SSE 读取响应
- **THEN** 依次收到零个或多个增量内容事件，最后收到一个完成事件，完整回复已落库

#### Scenario: agent 执行失败
- **WHEN** agent CLI 以非零退出码结束或执行超时
- **THEN** 前端收到错误事件（含可读中文错误说明），该消息在库中标记为失败状态

### Requirement: 会话内串行与超时控制
同一会话 MUST 同时只允许一个进行中的消息（重复发送返回 409）。agent 执行超时 SHALL 取 `config.json` 对应 agent 的 `timeout_sec`，超时后 MUST 终止子进程并下发错误事件。SSE 客户端断开 MUST NOT 中断进行中的 agent 任务，回复完成后仍正常落库。

#### Scenario: 并发发送被拒绝
- **WHEN** 会话有消息正在处理时客户端再次发送消息
- **THEN** 返回 HTTP 409，提示当前会话有进行中的消息

#### Scenario: 断线后恢复
- **WHEN** SSE 连接在回复中途断开，稍后客户端重新拉取该会话消息
- **THEN** 完整回复（或失败状态）已存在于历史消息中
