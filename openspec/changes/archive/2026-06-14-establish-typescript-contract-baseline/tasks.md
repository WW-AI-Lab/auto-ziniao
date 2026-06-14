# Tasks: establish-typescript-contract-baseline

## 1. Workspace Setup

- [x] 1.1 确认 Node 版本策略并建立根级 workspace 文件：`package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`；命令至少包含 `typecheck`、`test`、`build`、`validate:baseline`。
- [x] 1.2 创建 `packages/core` 包骨架，仅包含无浏览器副作用的路径、JSON/JSONL、时间、错误类型工具；不得引入 ZClaw、Agent、WebAdmin server 依赖。
- [x] 1.3 创建 `packages/schemas` 包骨架，依赖 Zod 与 JSON Schema 导出工具，导出公共类型与 schema 入口。
- [x] 1.4 验证现有 Python 入口未受影响：执行 `python3 manager.py validate orders_overview` 与 `python3 manager.py list`。

## 2. Flow Contract Schemas

- [x] 2.1 实现 flow definition schema：顶层字段、`params` 注释 key 规则、`retry`、`on_success`、`on_fail_final`、`heal.hints`。
- [x] 2.2 实现 flow step schema：ZClaw 工具、内置 action、`args`、`save`、`condition`、`validate`、`on_fail`、`goto`、`branch`、`@extracts/*.js` 引用。
- [x] 2.3 实现 schema 辅助静态校验：步骤 id 唯一、跳转目标存在、未知工具 error、未知 action warning、非法 `on_fail.action` error、未声明 `params.*` warning。
- [x] 2.4 实现运行数据 schema：`runs.jsonl`、`heals.jsonl`、`logs/heals/*.json`、`known_issues.json`，并为历史可选字段提供兼容默认值或 optional 声明。
- [x] 2.5 实现 WebAdmin DTO schema 覆盖当前 schedule/chat 数据形态，但不修改 WebAdmin 后端代码。
- [x] 2.6 实现 JSON Schema 导出命令，并验证导出的 flow schema 可校验当前合法 flow。

## 3. Compatibility Fixtures and Golden Baseline

- [x] 3.1 建立合法 flow fixture/golden，覆盖 `account_health`、`inventory_check`、`orders_overview`、`switch_language`、`webadmin_selftest` 的 id、version、enabled、params、步骤 id、工具/动作集合、extract 依赖和 Python validate 摘要。
- [x] 3.2 增加动态测试读取当前 `flows/*.json`（排除 `_template.json`），确保新增 flow 自动纳入 schema 解析。
- [x] 3.3 建立非法 flow fixtures：缺少 `steps`、重复步骤 id、未知工具、非法 `on_fail.action`、不存在跳转目标、未声明参数引用、缺失 extract。
- [x] 3.4 增加 extract 引用校验测试：确认合法引用存在，缺失引用返回结构化错误。
- [x] 3.5 明确 fixture/golden 只做静态解析与文件存在性检查，不执行 extracts JS、不调用 ZClaw bridge。

## 4. Baseline Validation Command

- [x] 4.1 实现 `validate:baseline` 串联 Python flow validate、TS typecheck、TS tests、JSON Schema 导出校验。
- [x] 4.2 增加静态安全扫描，覆盖新增 TS 源码与 workspace 配置，阻断 `playwright`、`selenium`、`puppeteer`、`browser-use`、本机浏览器打开命令和绕过 ZClaw bridge 的可疑路径。
- [x] 4.3 验证 baseline 命令不会调用 `POST /zclaw/tools/invoke`、不会执行 `open_store`、`visit_page`、`execute_script`、不会启动本机浏览器。
- [x] 4.4 记录 baseline 命令输出格式，保证失败时能定位到具体 flow、step 或 fixture。

## 5. Documentation and Handoff

- [x] 5.1 更新 README 或 TS 蓝图阶段状态，说明当前已进入 M1：契约与 TS 骨架；现有生产命令仍是 `python3 manager.py ...`。
- [x] 5.2 在文档中列出后续 change 顺序：`packages/zclaw`、`packages/flow-engine`、`packages/self-heal`、CLI/WebAdmin 迁移；明确本 change 不包含这些实现。
- [x] 5.3 记录实现阶段的回滚方式：删除新增 workspace 与 `packages/*` 后，Python 引擎仍可独立运行。

## 6. Architecture Verification

- [x] 6.1 运行 `pnpm typecheck`、`pnpm test`、`pnpm build`（或等价 workspace 命令）并记录结果。
- [x] 6.2 运行 `pnpm validate:baseline`，确认 Python validate、TS schema/golden、安全扫描全部通过。
- [x] 6.3 运行 `python3 manager.py validate account_health`、`inventory_check`、`orders_overview`、`switch_language`、`webadmin_selftest`，确认 TS 基线没有破坏现有 flow 校验。
- [x] 6.4 执行静态检查确认 `packages/core` 与 `packages/schemas` 不包含 `9481`、`/zclaw/` 访问或 `open_store`、`visit_page`、`execute_script` 的运行调用；schema 工具名常量允许存在。
- [x] 6.5 执行回滚验证演练：临时移除/忽略新增 TS workspace 后，`python3 manager.py list` 与 `python3 manager.py validate orders_overview` 仍可运行。
