## Context

当前 WebAdmin chat 的真实能力集中在 `apps/api`：`apps/api/src/app.ts` 注册 `/api/chat/*`，`apps/api/src/storage.ts` 保存 SQLite session/message，`apps/api/src/openclaw-gateway.ts` 通过 OpenClaw Gateway RPC 发送消息。前端 `apps/web/src/pages/Chat.tsx` 已有会话列表、消息流、输入框和一个会话级 Agent `Select`。

需要调整的关键点有两个：第一，前端必须统一适配，不应因后续新增 Gemini CLI、OpenCode 或其他 Agent 而修改；第二，后端应自动探索本机已存在的 supported Agents，配置文件只做覆盖/禁用/自定义，而不是唯一来源。这个设计把 Agent 生态变化控制在 `apps/api` adapter/discovery 层，并把浏览器安全边界保持在现有规则内。

本机只读检查确认 `codex` 与 `claude` 命令存在。真实调用仍不进入 baseline，因为它依赖登录、网络、模型额度和本机策略。

## Goals / Non-Goals

**Goals:**

- 后端自动发现 supported local Agents，并通过 `/api/chat/agents` 返回统一、安全的 metadata。
- 实现 OpenClaw Gateway、codex CLI、Claude Code CLI 三类 chat adapter，且 adapter 失败不跨类型 fallback。
- 前端 Agent selector 完全 metadata-driven：新增 Agent 时只需后端 discovery/adapter 支持，前端无需改代码。
- 选择 Agent 后保存为下次默认；新建会话优先使用偏好，偏好不可用时自动回退。
- 复用 self-heal command runner 的安全诊断语义，但保持 self-heal 与 WebAdmin chat 独立。
- 默认验证不调用真实 Agent、OpenClaw Gateway、ZClaw bridge 或本机浏览器。

**Non-Goals:**

- 不实现通用 Agent 管理后台或插件市场。
- 不让前端理解每个 Agent 的命令参数、token 或运行策略。
- 不把 OpenClaw chat 改成 `openclaw agent --deliver`、Feishu 或其他外部投递路径。
- 不新增 Playwright/Selenium/Puppeteer/browser-use、本机浏览器打开或 ZClaw bridge fallback。
- 不在首版实现 Gemini CLI/OpenCode adapter；但后端 metadata/discovery 设计必须允许未来只改后端即可接入。

## Architecture Assessment

### Existing Design Reuse

- 复用现有 `GatewayChatClient` 行为作为 `openclaw-gateway` adapter，不改变 Gateway RPC session key、timeout 和错误语义。
- 复用 `packages/schemas/src/webadmin.ts` 作为 API/前端 DTO 真相来源，避免前端重复定义 Agent metadata。
- 复用 `apps/api` 的 Fastify injection 测试、临时 repo/data root、mock chat client 和 SQLite storage 模式。
- 复用 `packages/self-heal` 的 command placeholder、timeout、exit code、stderr truncation、command missing 等诊断语义。
- 复用 `scripts/security-scan.ts`，只为受控 Agent CLI adapter 增加精确允许范围，不放宽浏览器自动化和直接 ZClaw bridge 规则。

### Boundaries and Ownership

- `apps/api` 拥有 `AgentDiscovery`、`ChatAgentAdapter`、adapter registry、配置覆盖合并、CLI 子进程执行、Agent preference storage 和 secret-safe metadata 输出。
- `packages/schemas` 拥有 `ChatAgentInfo`、`ChatAgentDiagnostic`、`ChatPreference`、`ChatAdapterType` 等 DTO。
- `apps/web` 只根据 metadata 渲染 selector：字段包括 `name`、`label`、`type`、`icon`/`display`、`available`、`diagnostic`、`capabilities`。UI 不包含 `if codex/if claude` 类型专属逻辑。
- `packages/self-heal` 继续通过自己的 `AgentRunner` 触发修复；它可兼容共享 command config 字段，但不调用 WebAdmin chat adapter，也不依赖 `apps/api`。
- repo config 是覆盖层：可以 override 自动发现 Agent 的 label、timeout、command、disabled，也可以声明额外 `command-cli` Agent。WebAdmin SQLite 是用户偏好层，只存默认 Agent 名称。

### Options and Rationale

- 选择“自动发现 + config overlay”，而不是“纯 config”。原因是用户明确要求 supported Agent 本机存在就自动出现；overlay 保留生产可控性和禁用能力。
- 选择“后端 metadata-driven UI”，而不是在前端枚举 Agent 类型。原因是这能保证后续新增 Agent 不修改前端，只扩展后端 discovery/adapter 和 metadata。
- 选择“CLI adapter 使用 argv array + placeholder”，而不是 shell command string。原因是避免 shell 注入和跨平台 quoting 问题，也更接近 self-heal 已有 runner 语义。
- 选择“真实 CLI smoke 可选”，而不是 baseline 默认调用。原因是真实 Agent CLI 依赖本机登录、网络和额度，不适合默认验证链。
- 选择“OpenClaw Gateway 首版默认 discovered/available，发送时二次验证 Gateway 连通”。原因是 Gateway 是本机后台服务而不是稳定命令路径；页面加载阶段不应主动建立 WebSocket 或阻塞等待。无 config 时返回内置 OpenClaw metadata；发送失败时通过现有 Gateway RPC diagnostic 呈现。
- 选择“保留 unavailable/disabled metadata”。原因是前端需要通用展示 diagnostic，用户也需要知道某个 supported Agent 为什么不可用；发送和新会话默认选择只允许 `available: true` 的 Agent。

### Quality Attributes

- 安全：前端不接触 command/token/prompt_path；metadata 过滤敏感字段；CLI adapter 不用 shell；security scan 继续阻断本机浏览器与直接 bridge。
- 可靠性：discovery 失败不影响 API 启动；单个 Agent unavailable 会以 metadata diagnostic 暴露；send 时二次校验 Agent available。
- 可维护性：新增 Agent 的稳定路径是新增后端 discoverer/adapter 和 metadata，不改 `apps/web`。
- 可测试性：discovery 使用可注入 command locator；adapter 使用 mock command；API 使用 Fastify injection；前端用 schema DTO typecheck/build。
- 可观测性：message extras/SSE 错误包含 adapter type、agent name 和 bounded diagnostics，不暴露完整命令或 prompt。

### Complexity and Exceptions

新增 `AgentDiscovery` 与 `ChatAgentAdapter` 是必要抽象，因为自动发现和 adapter 调度是两个不同职责：发现回答“本机有哪些 supported Agents 可用”，adapter 回答“这个 Agent 如何发送消息”。如果把两者写进 route handler，后续新增 Agent 会持续扩大 `app.ts` 并增加前端耦合。

新增 preference storage 只保存默认 Agent 名称，可复用 `meta` 或新增小型 settings 表。回滚时忽略该 key 即可；如果偏好指向不可用 Agent，API 回退到 config/default，不阻塞用户新建会话。

## Decisions

1. Agent discovery 输出标准 metadata。
   - 选择：每个 discoverer 返回 `name`、`type`、`label`、`available`、`diagnostic`、`source`、`capabilities` 和 adapter-private config。
   - 替代方案：前端根据硬编码列表自行探测。
   - 理由：浏览器无法安全探测本机 CLI，也不应理解 Agent 运行细节。

2. Config overlay 按 name 合并自动发现结果。
   - 选择：自动发现为 base，`webadmin.chat.agents.<name>` 覆盖 label/timeout/command/disabled；未发现但配置了 `command-cli` 的 Agent 可显示为配置型 Agent。
   - 替代方案：配置完全替换发现结果。
   - 理由：替换会违背“存在就自动列出”，overlay 同时满足自动和治理。

3. 前端只依赖通用 metadata 字段。
   - 选择：selector 渲染 `label ?? name`、`typeLabel`、`available`、`diagnostic`、可选 `icon` 字段。
   - 替代方案：为 codex/Claude/OpenClaw 写前端分支和图标逻辑。
   - 理由：后续新增 Agent 不改前端是明确要求。

4. CLI adapter 首版非流式。
   - 选择：命令完成后统一发一个 `delta/done`；后续可基于同一 adapter result 增加 stream-json。
   - 替代方案：首版实现所有 CLI 的 streaming 解析。
   - 理由：先保证安全、诊断和稳定契约，避免为不同 CLI 的流格式增加首版复杂度。

5. 每个实施步骤后更新 `tasks.md`。
   - 选择：完成并验证一个任务分组后立即勾选对应 checkbox。
   - 替代方案：最后统一更新。
   - 理由：用户明确要求逐步实施、逐步验证和状态同步。

## Risks / Trade-offs

- [Risk] 自动发现误判 Agent 可用，例如命令存在但未登录，或 OpenClaw Gateway 未启动。 -> Mitigation：discovery 只标记 command/default entry presence，send 失败返回 bounded diagnostic；可选 smoke 验证真实可用性。
- [Risk] CLI 默认参数随版本变化。 -> Mitigation：config overlay 支持覆盖 command；docs 记录 `codex exec` 与 `claude -p` 当前推荐模板。
- [Risk] 前端 metadata 过于通用导致展示信息不足。 -> Mitigation：后端提供 `label`、`typeLabel`、`description`、`diagnostic` 和 `capabilities`，前端做通用展示。
- [Risk] Security scan 误报受控 CLI adapter。 -> Mitigation：只为 `apps/api` 内的 Agent command adapter 增加精确例外，保留浏览器自动化和 direct bridge 规则。
- [Risk] 切换 Agent 后历史上下文不兼容。 -> Mitigation：切换只影响后续消息；session header/list 显示当前 Agent，message extras 记录生成该回复的 Agent。

## Migration Plan

1. 更新 proposal/spec/tasks 后先让 sub-agent review，确认澄清点已进入设计。
2. 扩展 schemas 和 config/discovery，保持旧 `openclaw` config 兼容。
3. 引入 adapter registry，将现有 OpenClaw Gateway 包装成 adapter。
4. 实现 command adapter、codex/Claude Code discoverer 和默认模板。
5. 加入 preference storage/API，并调整 session 创建/更新。
6. 更新前端 selector 为 metadata-driven。
7. 每个阶段由 sub-agent 执行测试/审查，验证通过后更新 `tasks.md`。
8. 完成后更新 docs，运行 baseline 与 OpenSpec 校验，归档 change，提交 Git。

## Open Questions

- 是否为 `command-cli` 暴露用户自定义 icon？建议首版只支持通用 `icon` string，由前端按文本/emoji/内置图标兜底。
