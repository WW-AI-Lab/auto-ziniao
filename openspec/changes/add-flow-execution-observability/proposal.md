## Why

当前 WebAdmin 的 `/flows` 和 `/schedules` 页面只能看到最近运行摘要或计划任务触发摘要，无法从一次失败运行继续查看完整失败原因、失败 step、运行参数、输出摘要、自愈是否触发、OpenClaw/Agent 是否执行以及自愈产物位置。以 `account_health` 为例，用户手动运行显示失败后，只能看到短错误文本，无法判断是页面结构变化、提取脚本失败、bridge 环境问题，还是 self-heal 链路没有实际接入。

这会直接削弱本仓库的核心目标：可重复执行的 flow 在异常时应有可追溯诊断，并能清楚展示 0 tokens 命中、自愈触发、跳过、失败或超时。现有后端已经有 `data/logs/runs.jsonl`、`learnings/heals.jsonl`、`data/logs/heals/`、`schedule_runs` 和 `ManualRunStatus` 等基础，但 WebAdmin 执行入口、日志关联与前端查看体验没有形成闭环，需要先用 OpenSpec 明确实现边界。

## What Changes

- 在 WebAdmin API 中提供统一的 flow 执行历史与执行详情查询能力，支持按 `flow_id`、`schedule_id`、运行来源、状态分页查看过去的手动运行和计划运行。
- 扩展执行记录的可见字段，展示成功结果摘要、输出文件引用、失败原因、`failed_step`、运行参数、耗时、触发来源以及关联的 self-heal 事件或 heal context/prompt。
- 调整 WebAdmin 手动运行与计划任务运行的执行编排，使默认行为与 CLI 一致：除显式禁用外，失败后应触发 `packages/self-heal`，并把 trigger/skip/failure/timeout 结果写入可查询日志。
- 在 `/flows` 页面增加 flow 级历史与详情入口；从 flow 列表直接查看时能看到该 flow 过去运行、当前失败原因和自愈状态。
- 在 `/schedules` 页面增加计划任务运行历史的详情入口；从计划任务查看时能关联到对应 flow run 的完整日志，而不是只显示 `schedule_runs.error` 摘要。
- 不引入新的浏览器自动化通道、外部日志服务、队列系统或直接 ZClaw bridge 访问；继续复用 `@ziniao/flow-engine`、`@ziniao/self-heal`、SQLite 和现有 JSONL 运行日志。

## Capabilities

### New Capabilities

- 无。该变更在现有 TypeScript WebAdmin、flow engine 日志和 self-heal 能力上补齐可观测闭环。

### Modified Capabilities

- `typescript-webadmin-api`: 扩展 run history/detail API、手动运行和计划运行的日志关联、自愈触发与查询契约。
- `typescript-webadmin-frontend`: 扩展 `/flows` 与 `/schedules` 页面，提供统一执行历史、失败详情和 self-heal 状态查看体验。
- `typescript-self-heal`: 明确 WebAdmin 编排方复用 self-heal 时应暴露的结果字段、事件关联和 mock-only 验证约束。

## Architecture Impact

- 相关 specs：`typescript-webadmin-api`、`typescript-webadmin-frontend`、`typescript-self-heal`、`typescript-flow-engine`、`flow-compatibility-baseline`。
- 相关模块：`apps/api/src/runner.ts`、`apps/api/src/app.ts`、`apps/api/src/scheduler.ts`、`apps/api/src/storage.ts`、`apps/web/src/pages/Flows.tsx`、`apps/web/src/pages/Schedules.tsx`、`apps/web/src/api.ts`、`packages/schemas/src/webadmin.ts`、`packages/self-heal/src/index.ts`。
- 复用能力：`@ziniao/flow-engine` 负责实际 flow 执行和 `data/logs/runs.jsonl` 写入；`@ziniao/self-heal` 负责错误分类、prompt/context、cooldown、Agent runner；`apps/api` 只做 WebAdmin 编排和查询聚合；`apps/web` 只通过 same-origin `/api/*` 访问。
- 数据模型：保留 `data/logs/runs.jsonl` 作为 flow run 历史事实来源；保留 `learnings/heals.jsonl` 与 `data/logs/heals/` 作为 self-heal 事实来源；SQLite 可扩展 WebAdmin 自有的 run index/correlation 字段，用于手动 token、schedule run 与 JSONL run 的关联。
- 安全边界：不改变 ZClaw bridge 最高安全规则；默认测试必须使用 mock tool client、mock Agent runner、临时 data root、固定 clock 和 no-op sleeper，不访问真实 bridge 或真实 OpenClaw CLI。

## Impact

- API：新增或扩展 `/api/runs`、`/api/runs/:runId`、`/api/flows/:flowId/runs`、`/api/schedules/:sid/runs`、`/api/flow-runs/:token` 的响应契约。
- UI：`/flows` 增加运行历史/详情抽屉或页面；`/schedules` 的运行展开表增加详情入口与完整诊断信息。
- Schema：扩展 `@ziniao/schemas/webadmin` 中 run history、run detail、manual run 与 schedule run 相关 DTO。
- 测试：补充 WebAdmin API 注入测试、frontend typecheck/build、schemas 测试、self-heal mock 集成测试和 `pnpm validate:baseline` 覆盖。
- 运行态：生产仍监听 `127.0.0.1`，不新增服务、不新增外部依赖、不新增本机浏览器能力。
