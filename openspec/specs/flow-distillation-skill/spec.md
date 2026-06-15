# flow-distillation-skill Specification

## Purpose
沉淀 ziniao-assistant skill 的 flow 蒸馏工作流规范，确保 Agent 通过 WebAdmin API 完成 flow 创建与验证，不依赖本地文件系统或 CLI。
## Requirements
### Requirement: API-first flow distillation workflow
`ziniao-assistant` 的 flow 沉淀工作流 SHALL 通过 WebAdmin API 完成 flow 创建、extract 保存、flow 校验、flow 运行和产出确认。该 workflow MUST NOT 要求 Agent 读取或写入 repo-local `flows/`、`extracts/`、`docs/`、`data/` 路径，MUST NOT 要求执行 `pnpm auto-ziniao ...` CLI 命令作为沉淀步骤。

#### Scenario: distillation uses WebAdmin API
- **WHEN** Agent 按 `references/flow-distill.md` 沉淀一个已跑通任务
- **THEN** 创建 flow 使用 `POST /api/flows`，保存 extract 使用 `PUT /api/extracts/:name`，校验使用 `POST /api/flows/:flowId/validate`，运行使用 `POST /api/flows/:flowId/run`，产出确认使用 `GET /api/outputs` 或 `GET /api/outputs/preview`

#### Scenario: no filesystem or CLI dependency
- **WHEN** 检查 flow 沉淀 skill 文档
- **THEN** 文档不要求读取 `$REPO/docs/03-流程定义规范.md`、`$REPO/flows/_template.json`、`$REPO/flows/*.json`，也不要求执行 `pnpm auto-ziniao new`、`pnpm auto-ziniao validate` 或 `pnpm auto-ziniao run`

### Requirement: Embedded distillation contract
flow 沉淀 skill SHALL 内嵌完成沉淀所需的最小稳定契约，包括 flow 顶层字段、步骤字段、extract JS 规范、`validate`/`on_fail`/`branch`/`heal.hints` 要求和沉淀检查清单。内嵌契约 MUST 保持命令、API 名称、JSON key 和 tool name 为英文标识符，说明文字使用简体中文。

#### Scenario: agent can author without repo docs
- **WHEN** Agent 只有 skill 文档和本会话 bridge 轨迹
- **THEN** Agent 能根据内嵌契约构造 flow JSON、extract JS 和验证 checklist，而不需要读取 repo-local 规范文档

### Requirement: Distillation trace source
flow 沉淀 skill SHALL 将本会话真实成功的 bridge invoke 作为沉淀依据。成功 invoke 的 trace SHOULD 通过 `POST /api/traces` 写入 WebAdmin API；当 WebAdmin API 不可达时，trace 记录失败 MUST NOT 导致改用文件系统写入或本机浏览器方案。

#### Scenario: traces remain API-owned
- **WHEN** 一个成功 bridge invoke 需要记录为沉淀依据
- **THEN** skill 使用 `POST /api/traces` 记录工具名、参数、时间和说明；若 API 不可达，则仅报告记录缺失或继续依赖当前会话上下文

### Requirement: Distillation safety boundary
flow 沉淀 skill SHALL preserve ZClaw bridge safety rules. It MUST use only tool names discovered from `GET /zclaw/tools` for real browser operations, MUST NOT open local browsers or browser automation tools, and MUST stop when the ZClaw bridge is unavailable instead of falling back to another browser path.

#### Scenario: bridge unavailable during distillation run
- **WHEN** validate/run 阶段需要真实执行 flow 且 ZClaw bridge 不可达
- **THEN** skill 报告环境问题并停止真机验证，不调用本机 Chrome/Safari/Edge/Firefox/Chromium、Playwright、Selenium、Puppeteer 或 browser-use
