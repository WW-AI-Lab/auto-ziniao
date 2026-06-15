## ADDED Requirements

### Requirement: Production CLI entrypoint
系统 SHALL 将 `ziniao` 作为 M7 后唯一生产 CLI 入口。`ziniao` MUST 覆盖日常 `list`、`run`、`run-all`、`retry`、`new`、`validate`、`history`、`enable`、`disable`、`heals`、`stats` 和 `cron` 操作；MUST 通过 `@ziniao/flow-engine` 与 `@ziniao/self-heal` 编排真实工作；MUST NOT 提示用户回退到 `python3 manager.py`。

#### Scenario: production command help has no Python fallback
- **WHEN** 用户执行 `ziniao --help`
- **THEN** help 输出展示 TS CLI 命令面，并且不包含 `python3 manager.py` fallback 指引

#### Scenario: local smoke validates existing flow
- **WHEN** 用户执行 `pnpm ziniao validate orders_overview`
- **THEN** CLI 通过 TS flow-engine 完成校验并返回 exit code 0，不调用 Python runtime

## MODIFIED Requirements

### Requirement: Observability commands
系统 SHALL 提供运行观测命令。`ziniao history [flow_id]` MUST 读取 `data/logs/runs.jsonl` 并支持按 flow 过滤；`ziniao heals` MUST 读取 `learnings/heals.jsonl`；`ziniao stats` MUST 基于最近运行日志计算成功/失败统计；`ziniao cron` MUST 基于 enabled 且有 `schedule` 的 flows 输出 `ziniao run <flow_id>` 或等价构建产物命令的 crontab 建议。M7 后 CLI MUST NOT 输出继续使用 `python3 manager.py run` 的过渡提示。

#### Scenario: history handles missing log
- **WHEN** `data/logs/runs.jsonl` 不存在
- **THEN** `ziniao history` 以 exit code 0 提示没有运行记录

#### Scenario: heals handles missing log
- **WHEN** `learnings/heals.jsonl` 不存在
- **THEN** `ziniao heals` 以 exit code 0 提示没有自愈记录

#### Scenario: cron prints TS production command
- **WHEN** 用户执行 `ziniao cron`
- **THEN** CLI 输出使用 `ziniao run` 的调度建议，并且不包含 `python3 manager.py run`

### Requirement: CLI offline validation
系统 SHALL 为 CLI 提供离线测试和 baseline 验证。默认测试 MUST 使用临时 repo/data root、mock tool client、no-op sleeper、fixed clock 和 mock Agent runner；MUST NOT 调用真实 ZClaw bridge、MUST NOT 执行真实店铺 flow、MUST NOT 调用真实 Agent CLI。`pnpm validate:baseline` MUST 覆盖 CLI typecheck、单测、构建、安全扫描和 M7 后生产命令 smoke；MUST NOT 调用 Python runtime。

#### Scenario: CLI tests do not call real bridge
- **WHEN** 用户执行 `pnpm test`
- **THEN** CLI 测试不会调用 `open_store`、`visit_page`、`execute_script` 的真实 bridge 实现，也不会启动本机浏览器

#### Scenario: baseline includes CLI
- **WHEN** 用户执行 `pnpm validate:baseline`
- **THEN** CLI 的 typecheck、单测、构建产物和安全边界与其他 TS 包一并验证

#### Scenario: Python production entry is removed
- **WHEN** M7 实现完成后用户执行 baseline 或 CLI smoke
- **THEN** 验证使用 `ziniao` 命令完成，并且不要求 `python3 manager.py` 存在
