## 1. Schema Contract

- [ ] 1.1 在 `packages/schemas/src/flow.ts` 新增 `StepRiskSchema`、`PacingPolicySchema`、`StepPacingSchema`、`ConfirmGateSchema`，并导出对应 TypeScript 类型。
- [ ] 1.2 扩展 `FlowDefinitionSchema` 和 `FlowStepSchema`，支持顶层 `pacing`、step `risk`、step `pacing`、step `confirm`，保持历史 flow optional/pass-through 兼容。
- [ ] 1.3 在 `validateFlowContract()` 增加 pacing 静态校验：操作类工具缺 `risk` warning、critical 缺 `confirm` error、write/critical 缺后置验证 warning。
- [ ] 1.4 在 `packages/schemas/src/runtime-data.ts` 新增 `FlowRuntimeEventSchema`，覆盖 `pacing_wait`、`confirm_rejected`、`budget_rejected`、`store_lock_wait`、`store_lock_acquired`、`store_lock_released`。
- [ ] 1.5 更新 schema export，确保 flow definition JSON Schema 包含 pacing 字段，并导出 flow runtime event schema。

## 2. Flow Engine Runtime

- [ ] 2.1 在 `packages/flow-engine` 中实现 pacing policy resolver，按 `built-in default < flow.pacing < step.pacing` 合并有效策略。
- [ ] 2.2 实现 pacing scheduler，通过注入的 `sleeper` 执行 `beforeMs` 和 `afterMs`，并支持关闭 jitter 或 deterministic random 以保证测试稳定。
- [ ] 2.3 在 step tool/action 执行前后接入 scheduler，保持现有变量解析、分支、validate、`on_fail` 语义不回退。
- [ ] 2.4 实现 critical confirm gate：未授权时不调用目标 tool/action，返回结构化 failure、设置 `failed_step`，并阻止 `on_fail.retry` 绕过确认。
- [ ] 2.5 实现 `FlowExecutionRegistry` 或等价进程内 registry，支持 per-store/per-flow concurrency、连续失败计数、当日 run 预算的最小实现。
- [ ] 2.6 实现 runtime event writer，将 pacing、confirm、budget、store lock 事件追加到 `data/logs/flow_events.jsonl`，并避免写入敏感值或大体积 args。
- [ ] 2.7 保持 `packages/flow-engine` 不依赖 `@ziniao/self-heal`，不直接访问 `127.0.0.1:9481` 或 `/zclaw/*`。

## 3. Tests and Fixtures

- [ ] 3.1 增加 schema 单测：历史 flow 未声明 pacing 仍解析成功，合法 pacing 解析成功，非法 `risk`、负数 wait、非法 `confirm` 返回稳定 issue。
- [ ] 3.2 增加静态校验 fixture：缺 `risk` warning、critical 缺 confirm error、write 缺后置验证 warning。
- [ ] 3.3 增加 runtime 单测：fake sleeper 记录 before/after wait，且测试不等待真实时间。
- [ ] 3.4 增加 critical confirm 单测：未授权不调用 mock tool client，授权后正常执行。
- [ ] 3.5 增加 budget/store lock 单测：per-flow concurrency reject、同店铺串行或等待、失败后 lock release。
- [ ] 3.6 增加 event 单测：临时 `dataRoot` 下生成 `flow_events.jsonl`，逐行通过 `FlowRuntimeEventSchema`。
- [ ] 3.7 增加 baseline fixture，覆盖含 write/critical step 的 mock flow，确认默认 baseline 不连接真实 ZClaw bridge。

## 4. Documentation

- [ ] 4.1 更新 `docs/03-流程定义规范.md`，加入 `pacing`、`risk`、`confirm` 字段说明、示例和沉淀 checklist。
- [ ] 4.2 更新 `docs/07-操作节奏与流程稳定性规划.md`，链接本 OpenSpec change，并标记哪些规划进入本阶段实现。
- [ ] 4.3 更新 README 和 AGENTS 中的边界：本 change 不修改 ZClaw bridge client 职责。

## 5. Architecture Verification

- [ ] 5.1 运行 `pnpm typecheck`，确认新增 schema/runtime 类型无错误。
- [ ] 5.2 运行 `pnpm test`，确认 schema、runtime、event 和 budget/confirm 单测通过。
- [ ] 5.3 运行 `pnpm build`，确认 workspace build 通过。
- [ ] 5.4 运行 `pnpm validate:baseline`，确认 pacing policy 纳入离线 baseline，且不要求紫鸟客户端在线。
- [ ] 5.5 运行 `pnpm security:scan`，确认 `packages/flow-engine` 未直接访问 bridge，且未引入 Playwright/Selenium/Puppeteer/browser-use 或本机浏览器打开命令。
- [ ] 5.6 运行 `openspec validate add-typescript-flow-pacing-policy --strict`，确认 proposal/design/specs/tasks 可归档。
- [ ] 5.7 记录回滚验证方式：删除本 change 对 `packages/schemas`、`packages/flow-engine`、测试、文档和 root scripts 的改动后，baseline 仍可运行。
