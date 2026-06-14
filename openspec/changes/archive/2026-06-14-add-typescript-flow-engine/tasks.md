## 1. Package Scaffold

- [x] 1.1 创建 `packages/flow-engine/package.json`、`tsconfig.json` 和 `src/index.ts`，只依赖 `@ziniao/core`、`@ziniao/schemas`、`@ziniao/zclaw` 与 Node 标准库。
- [x] 1.2 更新 root `package.json`、`tsconfig.base.json`、`vitest.config.ts`，把 `packages/flow-engine` 纳入 `build`、`typecheck`、`test` 和 `validate:baseline`。
- [x] 1.3 确认 `scripts/security-scan.ts` 继续只允许 `packages/zclaw` 直接访问 bridge，`packages/flow-engine` 不进入 bridge allowlist。

## 2. Loader and Validation

- [x] 2.1 实现 flow loader：支持按 `flowId` 从 `flows/<id>.json` 加载，也支持从显式 file path 加载。
- [x] 2.2 实现 `validateFlow()` wrapper，复用 `packages/schemas` 的 `validateFlowContract()`，不重复维护 DSL schema。
- [x] 2.3 实现 `parseParams(pairs)`，兼容当前 CLI 的 `key=value` 语义，非法格式返回明确错误。
- [x] 2.4 添加 loader/validator 单测，覆盖当前 flow、缺失 flow、非法 fixture、Python validate agreement。

## 3. Runtime Context and Control Flow

- [x] 3.1 实现 `FlowRunner` 与 per-run context，合并 flow 默认 params 与调用方 params，忽略 `_` 开头字段。
- [x] 3.2 实现变量解析：纯 `${...}` 保留原始类型，内嵌变量转字符串，支持对象/数组递归解析，支持 `${date}`、`${datetime}`、`${timestamp}`。
- [x] 3.3 实现 condition evaluator，覆盖 `eq`、`ne`、`contains`、`not_contains`、`starts_with`、`is_true`、`is_false`、`gt`、`lt`、`is_empty`、`not_empty`。
- [x] 3.4 实现 branch/goto/on_fail.branch/end 目标解析和最大执行次数保护。
- [x] 3.5 添加 runtime 单测，覆盖参数覆盖、变量解析、`switch_language` 分支路径、死循环保护和失败现场记录。

## 4. Validation Rules and Built-in Actions

- [x] 4.1 实现 validate 规则：`path`、`not_empty`、`min_rows`、`require_fields`、`contains`。
- [x] 4.2 实现内置 action：`sleep`、`print`、`assert`、`fail`、`branch`、`goto`、`close_store`，其中 `sleep` 必须支持测试注入 no-op sleeper。
- [x] 4.3 实现 output action：`save_json`、`save_csv`，相对 filename 写入 `data/output/`，`save_csv` 使用 UTF-8 with BOM。
- [x] 4.4 添加 action/validate 单测，覆盖 `webadmin_selftest`、assert failure、save_json/save_csv 输出和 validate failure。

## 5. ZClaw Tool Dispatch

- [x] 5.1 定义最小 `FlowToolClient` interface，并实现基于 `packages/zclaw` 的 adapter；测试默认使用 mock client。
- [x] 5.2 实现工具步骤特殊映射：`list_stores`、`open_store`、`visit_page`、`execute_script`、`click_element`、`take_screenshot`、`wait_for_element`、`close_store`。
- [x] 5.3 实现通用合法 tool fallback：其他合法 ZClaw tool 通过 `invoke(tool, args)` 调度。
- [x] 5.4 实现 `@extracts/*.js` 文件读取与变量替换，确认 Node 不执行 extract JS。
- [x] 5.5 添加 tool dispatch 单测，覆盖 storeName/storeId 选择优先级、store_selector first、targetId/storeId 状态同步、extract 文件缺失、mock 参数记录。

## 6. Run Result, Logs, and Output

- [x] 6.1 实现 `runFlow()` 返回结构：success 包含 `{ status, data }`，失败包含 `{ status, error, failed_step, heal }`。
- [x] 6.2 实现 flow-level retry 和 step-level `on_fail.retry/skip/branch/abort/heal` 行为；M3 中 `heal` 只记录 failure metadata，不触发 Agent。
- [x] 6.3 实现 `data/logs/runs.jsonl` append，字段兼容 Python `log_run()` 与 `RunLogEntrySchema`。
- [x] 6.4 添加 run result/log 单测，使用临时 repo/data root，验证成功日志、失败日志、data_summary、params 截断和 schema parse。

## 7. Compatibility and Baseline Verification

- [x] 7.1 为当前五个 flow 建立 TS flow-engine 离线语义/golden 测试，覆盖当前 DSL 使用面。
- [x] 7.2 更新 `pnpm validate:baseline`，纳入 flow-engine 离线测试，确认不连接真实 ZClaw bridge。
- [x] 7.3 运行 `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm validate:baseline`。
- [x] 7.4 运行 `pnpm security:scan` 和精确静态边界检查，确认 `packages/flow-engine` 不包含直接 bridge 访问。
- [x] 7.5 运行 Python 兼容验证：`python3 manager.py list`、`python3 manager.py validate orders_overview`。

## 8. Explicit Double-Run Validation

- [x] 8.1 先用不依赖真实 bridge 的 `webadmin_selftest` 或等价本地 flow 做 Python/TS 双跑，记录命令、状态、run log 摘要和差异。
- [x] 8.2 如用户确认紫鸟客户端在线和可用测试店铺，再选择一个低风险真实 bridge flow 做显式双跑；bridge 不可达时停止并记录环境阻塞，不改用本机浏览器。
- [x] 8.3 将双跑结果写入 `docs/06-TS迁移进度与路线图.md` 或 dedicated M3 验证小节。

## 9. Documentation and OpenSpec

- [x] 9.1 更新 README、AGENTS、`docs/05-TS重构技术蓝图.md`、`docs/06-TS迁移进度与路线图.md`，记录 M3 范围、状态、验证命令、非目标和下一阶段。
- [x] 9.2 运行 `openspec validate add-typescript-flow-engine --strict` 并修复所有问题。
- [x] 9.3 做 M3 回滚演练或等价验证：隔离 `packages/flow-engine` 与 root script/alias 改动后，`python3 manager.py list` 和 `python3 manager.py validate orders_overview` 仍可运行。
