# agent-adapter-selection Specification

## Purpose
TBD - created by archiving change add-agent-adapter-selection. Update Purpose after archive.
## Requirements
### Requirement: Backend Agent discovery
系统 SHALL 在 WebAdmin API 后端自动发现 supported local Agents。若后端已有 adapter 支持某 Agent，且本机存在其所需命令或默认运行入口，则该 Agent MUST 自动出现在 Agent metadata 清单中，无需先写入 repo config。自动发现 MUST 至少覆盖 OpenClaw、codex 和 Claude Code。OpenClaw Gateway adapter 的首版默认运行入口 SHALL 使用内置 Gateway 配置并标记为 discovered；Gateway 连通性 MUST 在发送时二次验证。

#### Scenario: default OpenClaw is discovered without config
- **WHEN** repo config does not define any chat Agents
- **THEN** `/api/chat/agents` returns an available OpenClaw Agent using the built-in Gateway defaults

#### Scenario: installed codex is discovered
- **WHEN** 本机 `codex` 命令可被 locator 找到
- **THEN** `/api/chat/agents` 返回 codex Agent metadata，且该 Agent 可用于新建 chat session

#### Scenario: installed Claude Code is discovered
- **WHEN** 本机 `claude` 命令可被 locator 找到
- **THEN** `/api/chat/agents` 返回 Claude Code Agent metadata，且该 Agent 可用于新建 chat session

#### Scenario: missing supported Agent is unavailable
- **WHEN** 某 supported CLI Agent 的命令不存在
- **THEN** 后端返回该 Agent 的 metadata，标记 `available: false` 并包含 diagnostic，且该 Agent 不可用于发送

### Requirement: Config overlay for discovered Agents
系统 SHALL 将 repo config 作为自动发现结果的 overlay，而不是唯一来源。配置 MUST 能覆盖 discovered Agent 的 `label`、`timeout_sec`、`command`、`disabled`、`description` 和 display metadata；配置 MUST 能声明额外 `command-cli` Agent；配置 MUST 能禁用自动发现到的 Agent。

#### Scenario: config overrides discovered Agent label
- **WHEN** codex 被自动发现且 config 为 `codex` 设置 `label: "Codex 本机"`
- **THEN** `/api/chat/agents` 中 codex 的 label 使用配置值

#### Scenario: config disables discovered Agent
- **WHEN** Claude Code 被自动发现但 config 设置 `disabled: true`
- **THEN** Claude Code metadata 保留在响应中，标记 `available: false` 并包含 disabled diagnostic，且不可用于发送消息

### Requirement: Unified Agent metadata
系统 SHALL 输出前端可通用渲染的 Agent metadata。metadata MUST 至少包含 `name`、`type`、`label`、`available`、`timeout_sec`、`source` 和可选 `type_label`、`description`、`icon`、`diagnostic`、`capabilities`；metadata MUST NOT 包含 token、完整 command、完整 prompt、credential 或敏感本机路径。

#### Scenario: frontend receives generic metadata
- **WHEN** 前端请求 `/api/chat/agents`
- **THEN** 每个 Agent item 都可仅通过通用 metadata 字段展示，无需前端识别具体 Agent 类型

#### Scenario: sensitive fields are redacted
- **WHEN** Agent config 包含 token、token path、command array 或 prompt path
- **THEN** `/api/chat/agents` 响应不包含这些敏感字段

### Requirement: Safe command adapter
系统 SHALL 为 CLI 型 Agent 提供受控 command adapter。adapter MUST 使用 argv array 执行，不得使用 shell string；MUST 支持 prompt/session placeholders；MUST 支持 timeout、process kill、command missing、non-zero exit、stdout/stderr truncation 和结构化诊断。

#### Scenario: command success returns text
- **WHEN** mock command 输出 `hello` 并以 exit code 0 结束
- **THEN** adapter 返回 assistant text `hello`

#### Scenario: command failure returns diagnostic
- **WHEN** mock command 返回非 0 exit code 和 stderr
- **THEN** adapter 返回结构化 failure diagnostic，且不暴露完整 command 或 prompt

#### Scenario: command timeout is bounded
- **WHEN** mock command 超过 `timeout_sec`
- **THEN** adapter 终止进程并返回 timeout diagnostic

### Requirement: Offline validation
系统 SHALL 保持 Agent discovery 和 adapter 的默认验证离线。单测 MUST 使用 mock locator、mock command、临时 repo/data root 和 fixed clock；`pnpm validate:baseline` MUST NOT 调用真实 codex、Claude Code、OpenClaw Gateway、ZClaw bridge 或本机浏览器。

#### Scenario: baseline uses mocks
- **WHEN** `pnpm validate:baseline` 运行
- **THEN** Agent discovery 和 adapter 测试通过 mock 完成，不依赖真实 Agent 安装或登录状态

#### Scenario: local smoke is explicit
- **WHEN** 用户显式运行本机 Agent smoke
- **THEN** 可以调用真实 `codex` 或 `claude`，但该 smoke 不属于默认 baseline

