# typescript-cli Specification

## Purpose
TBD - created by archiving change add-typescript-cli. Update Purpose after archive.
## Requirements
### Requirement: CLI package and executable
系统 SHALL 提供 TypeScript CLI 包 `packages/cli`，其 workspace package name MUST 为 `@ziniao/cli`，并 MUST 暴露可执行命令 `ziniao`。CLI MUST 使用 `commander` 解析命令、参数和 help 信息，MUST 可通过 workspace scripts 或 package bin 在本仓库内运行。

#### Scenario: ziniao help 可用
- **WHEN** 用户执行 `ziniao --help` 或等价 workspace bin 命令
- **THEN** CLI 展示可用命令、全局选项和基础用法，并以 exit code 0 结束

#### Scenario: workspace build includes CLI
- **WHEN** 用户执行 root `pnpm build`
- **THEN** `packages/cli` 与既有 TS 包一同完成构建，并生成可执行入口所需产物

### Requirement: CLI command semantics
系统 SHALL 在 `ziniao` 中提供完整的命令语义。MUST 覆盖 `list`、`run`、`run-all`、`retry`、`new`、`validate`、`history`、`enable`、`disable`、`heals`、`stats`、`cron`。命令参数、成功/失败含义、数据文件读写和 exit code MUST 保持一致。

#### Scenario: validate success and failure exit codes
- **WHEN** 用户执行 `ziniao validate orders_overview`
- **THEN** CLI 对有效 flow 返回 exit code 0；当 flow 存在 fatal validation error 时返回非 0 并展示具体 issue

#### Scenario: list excludes template
- **WHEN** 用户执行 `ziniao list`
- **THEN** CLI 列出当前非 `_template.json` 的 flow，展示 id、名称、版本、启用状态、调度和最近运行摘要

#### Scenario: unknown flow command failure
- **WHEN** 用户执行 `ziniao run missing_flow`
- **THEN** CLI 返回非 0，提示 flow 不存在，并不得创建或修改 flow 文件

### Requirement: Flow execution integration
系统 SHALL 通过 `@ziniao/flow-engine` 执行 flow。`ziniao run` MUST 支持 `-p/--param k=v`、`-v/--verbose` 和 `--no-heal`；MUST 复用 flow-engine 的参数解析、变量解析、工具调度、output 写入和 `data/logs/runs.jsonl` 追加能力。`ziniao run-all` MUST 串行执行 enabled flows，保持低并发风险语义一致。

#### Scenario: run local flow with params
- **WHEN** 用户执行 `ziniao run webadmin_selftest -p greeting=hello --no-heal`
- **THEN** CLI 调用 TS flow-engine 运行该 flow，写入兼容 run log，并按结果返回对应 exit code

#### Scenario: run-all skips disabled flows
- **WHEN** 仓库中同时存在 enabled 和 disabled flows
- **THEN** `ziniao run-all` 只串行执行 enabled flows，并输出每个 flow 的结果摘要

#### Scenario: no-heal disables self-heal
- **WHEN** `ziniao run <flow> --no-heal` 的执行结果失败
- **THEN** CLI 不调用 self-heal，并返回运行失败对应的非 0 exit code

### Requirement: Self-heal CLI integration
系统 SHALL 在 `ziniao run` 失败且未传 `--no-heal` 时，通过 `@ziniao/self-heal` 组装失败上下文并触发自愈。CLI MUST 复用 self-heal 的错误分类、known issues、prompt/context rendering、cooldown、Agent runner adapter 和事件写入能力；MUST NOT 在 CLI 内重复实现自愈业务规则。

#### Scenario: failed run triggers self-heal
- **WHEN** flow-engine 返回失败结果且包含 failed step metadata，且用户未传 `--no-heal`
- **THEN** CLI 调用 self-heal，返回信息包含 heal id、prompt path、context path 或 skipped reason

#### Scenario: known issue skip is displayed
- **WHEN** self-heal 因 known issue 命中或 cooldown 返回 skipped
- **THEN** CLI 展示 skipped reason，并保留原始运行失败的非 0 exit code

#### Scenario: baseline uses mock agent
- **WHEN** CLI 测试覆盖 self-heal 触发路径
- **THEN** 测试使用 mock `AgentRunner` 或 dry-run，不调用真实 OpenClaw/Claude/Cursor 命令

### Requirement: Flow file management commands
系统 SHALL 提供 flow 文件管理命令。`ziniao new <flow_id> [name]` MUST 从 `flows/_template.json` 创建新 flow，并替换 `__FLOW_ID__` 与 `__FLOW_NAME__`；若目标文件已存在 MUST 拒绝覆盖。`ziniao enable <flow_id>` 与 `ziniao disable <flow_id>` MUST 只修改目标 flow 的 `enabled` 字段并保持 JSON 格式可读。

#### Scenario: new creates scaffold from template
- **WHEN** 用户执行 `ziniao new sample_flow 样例流程` 且 `flows/sample_flow.json` 不存在
- **THEN** CLI 从模板创建 flow 文件，写入替换后的 id/name，并提示后续 validate/run 命令

#### Scenario: new refuses overwrite
- **WHEN** `flows/orders_overview.json` 已存在且用户执行 `ziniao new orders_overview`
- **THEN** CLI 返回非 0，且不得覆盖现有文件

#### Scenario: enable and disable update only target flow
- **WHEN** 用户执行 `ziniao disable orders_overview` 后再执行 `ziniao enable orders_overview`
- **THEN** CLI 只更新该 flow 的 `enabled` 字段，并保持其他 flow 文件不变

### Requirement: Observability commands
系统 SHALL 提供运行观测命令。`ziniao history [flow_id]` MUST 读取 `data/logs/runs.jsonl` 并支持按 flow 过滤；`ziniao heals` MUST 读取 `learnings/heals.jsonl`；`ziniao stats` MUST 基于最近运行日志计算成功/失败统计；`ziniao cron` MUST 基于 enabled 且有 `schedule` 的 flows 输出 crontab 建议，但 M5 MUST NOT 自动安装或修改系统 crontab。

#### Scenario: history handles missing log
- **WHEN** `data/logs/runs.jsonl` 不存在
- **THEN** `ziniao history` 以 exit code 0 提示没有运行记录

#### Scenario: heals handles missing log
- **WHEN** `learnings/heals.jsonl` 不存在
- **THEN** `ziniao heals` 以 exit code 0 提示没有自愈记录

#### Scenario: cron prints production ziniao commands (M7)
- **WHEN** 用户执行 `ziniao cron`
- **THEN** CLI 输出调度建议，使用 `pnpm ziniao run <flow_id>` 作为 crontab 命令，不包含 Python fallback 文案

### Requirement: CLI safety boundary
系统 SHALL 保证 `packages/cli` 不成为新的浏览器或 bridge 网络出口。CLI MUST NOT 直接访问 `127.0.0.1:9481`、`/zclaw/tools` 或 `/zclaw/tools/invoke`；MUST NOT 读取 ZClaw API key；MUST NOT 打开本机 Chrome/Safari/Edge/Firefox/Chromium；MUST NOT 引入 Playwright、Selenium、Puppeteer、browser-use 或 `webbrowser` fallback。

#### Scenario: security scan rejects direct bridge access
- **WHEN** `packages/cli/src` 中出现 direct bridge URL、`/zclaw/tools` path 或 API key 读取逻辑
- **THEN** `pnpm security:scan` 失败，并提示 CLI 必须通过 flow-engine 间接执行工具步骤

#### Scenario: bridge unavailable has no browser fallback
- **WHEN** 用户执行真实 `ziniao run` 且 ZClaw bridge 不可达
- **THEN** CLI 返回环境错误并停止，不得改用本机浏览器、Playwright、Selenium、Puppeteer 或 browser-use

### Requirement: CLI offline validation
系统 SHALL 为 CLI 提供离线测试和 baseline 验证。默认测试 MUST 使用临时 repo/data root、mock tool client、no-op sleeper、fixed clock 和 mock Agent runner；MUST NOT 调用真实 ZClaw bridge、MUST NOT 执行真实店铺 flow、MUST NOT 调用真实 Agent CLI。`pnpm validate:baseline` MUST 覆盖 CLI typecheck、单测、构建和安全扫描。

#### Scenario: CLI tests do not call real bridge
- **WHEN** 用户执行 `pnpm test`
- **THEN** CLI 测试不会调用 `open_store`、`visit_page`、`execute_script` 的真实 bridge 实现，也不会启动本机浏览器

#### Scenario: baseline includes CLI
- **WHEN** 用户执行 `pnpm validate:baseline`
- **THEN** CLI 的 typecheck、单测、构建产物和安全边界与其他 TS 包一并验证

#### Scenario: CLI is sole production entry (M7)
- **WHEN** M7 完成后用户执行 `pnpm ziniao list` 和 `pnpm ziniao validate orders_overview`
- **THEN** 命令通过 TS CLI 执行，Python 入口已移除；历史恢复通过 git（commit `68d7db8a`）
