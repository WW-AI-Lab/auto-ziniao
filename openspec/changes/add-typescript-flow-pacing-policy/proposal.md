## Why

当前 flow DSL 已支持 `sleep`、`timeoutMs`、`retry.delayMs` 和 `on_fail.retry.delayMs`，但这些能力都依赖流程作者逐步手写，无法形成统一的操作节奏、风险分级、确认门槛和并发预算。`packages/flow-engine` 已经完成，并且 `packages/self-heal` 也已就位，现在需要把操作节奏能力设计成 flow-engine 中的共享契约，而不是继续在单个 flow 里散落固定等待。

本变更面向 TypeScript 架构：扩展 `packages/schemas` 与 `packages/flow-engine` 的契约和离线运行能力，作为后续 `packages/cli`、`packages/self-heal` 和 WebAdmin 接入的基础。

## What Changes

- 新增 TS flow pacing policy 能力，定义 flow 顶层 `pacing`、step 级 `risk`、step 级 `pacing`、`confirm` 与执行预算的契约。
- 扩展 flow schema 与静态校验：
  - `click_element`、`input_text`、`scroll_page`、`run_automation` 等操作类步骤未声明 `risk` 时给 warning。
  - `risk: "critical"` 的步骤必须有 `confirm` 或显式豁免，否则校验失败。
  - 写操作或关键操作后缺少 `validate`、`assert`、`wait_for_element`、`wait_for_navigation` 或等价后置验证时给 warning。
- 在 `packages/flow-engine` 中实现 TS-only pacing runtime：
  - 合并默认策略、flow 策略和 step 策略。
  - 通过已有 `sleeper`、`clock` 和 `toolClient` 注入点实现可测试等待。
  - 提供 per-store / per-flow 运行预算与进程内串行保护的最小实现。
  - 对 `critical` 步骤执行确认门槛，默认要求显式参数授权。
  - 写入结构化 pacing 事件，便于后续 CLI/WebAdmin 展示。
- 默认 baseline 继续离线执行，使用 mock tool client、fake sleeper / fixed clock，不调用真实 ZClaw bridge、不启动店铺浏览器、不调用真实 Agent CLI。
- 文档更新 `docs/03-流程定义规范.md`、`docs/07-操作节奏与流程稳定性规划.md`、README 和 AGENTS 相关边界。
- **不做**：不修改 `packages/zclaw`；不新增真实浏览器自动化通道。

## Capabilities

### New Capabilities

- `typescript-flow-pacing-policy`: 定义 flow engine 的操作节奏策略、风险分级、确认门槛、预算限制、pacing 事件和离线验证要求。

### Modified Capabilities

- `flow-contract-schemas`: 扩展 flow definition schema，支持 `pacing`、`risk`、`confirm` 和相关静态校验。
- `typescript-flow-engine`: 在 TS flow engine 中实现 pacing policy resolution、等待调度、确认门槛、预算拒绝和事件记录。
- `flow-compatibility-baseline`: 将 pacing policy 的 schema、runtime 和安全扫描纳入离线 baseline，继续保证默认验证不调用真实 ZClaw bridge。

## Architecture Impact

- 复用 `packages/schemas` 作为 flow DSL 唯一 schema 来源，不在 `packages/flow-engine` 重复维护 pacing schema。
- 复用 `packages/flow-engine` 已有 `sleeper`、`clock`、`toolClient`、`FlowRunnerOptions` 和 run log 输出模式，新增 pacing 只在 flow-engine 执行调度层实现。
- 复用 `packages/core` 的路径、JSON/JSONL、时间和错误基础能力；如需新增日志 helper，必须保持无浏览器副作用。
- 不修改 `packages/zclaw` 的职责。ZClaw client 仍只负责 bridge transport、工具发现和 wrapper，不隐式节流，也不持有 flow 级状态。
- 不抢占 `add-typescript-self-heal` 范围。self-heal 只在后续消费 pacing 事件或确认拒绝结果，不在本 change 内接入 Agent 修复链路。
- 不新增数据库、daemon、外部服务或本机浏览器自动化依赖；进程内 store lock 和内存预算作为第一阶段最小实现，后续 CLI/WebAdmin 可再评估持久化锁。

## Impact

- 代码：`packages/schemas`、`packages/flow-engine`、相关测试、root scripts 或安全扫描（如需）。
- Specs：新增 `typescript-flow-pacing-policy`；修改 `flow-contract-schemas`、`typescript-flow-engine`、`flow-compatibility-baseline`。
- 文档：更新 flow DSL、操作节奏规划、README/AGENTS 中的边界。
- 运行：不改变现有 flow 默认运行结果，除非用户在 flow engine 中显式启用或 flow 声明 pacing/confirm。
