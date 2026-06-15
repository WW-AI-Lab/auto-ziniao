# typescript-self-heal Specification

## Purpose
TBD - created by archiving change add-typescript-self-heal. Update Purpose after archive.
## Requirements
### Requirement: Self-heal package boundary
系统 SHALL 提供 TypeScript 自愈包 `packages/self-heal`，用于迁移 Python `engine/self_heal.py` 的自愈触发能力。该包 MUST 只依赖 Node 标准库、`@ziniao/core` 与 `@ziniao/schemas`，MUST NOT 依赖 `@ziniao/zclaw`，MUST NOT 直接访问 `127.0.0.1:9481`、`/zclaw/tools` 或 `/zclaw/tools/invoke`，MUST NOT 打开本机浏览器或引入 Playwright/Selenium/Puppeteer/browser-use。

#### Scenario: 包不直接访问 bridge
- **WHEN** 扫描 `packages/self-heal/src`
- **THEN** 不存在直接 ZClaw bridge HTTP 调用、ZClaw API key 读取、本机浏览器打开命令或浏览器自动化依赖

#### Scenario: Self-heal 通过 CLI 触发 (M7)
- **WHEN** M7 完成后用户执行 `pnpm ziniao run` 遇到可恢复错误
- **THEN** self-heal 由 TS flow-engine 和 `packages/self-heal` 触发；Python 入口已移除

### Requirement: Error classification compatibility
系统 SHALL 提供与 Python `classify_error()` 兼容的错误分类能力。分类 MUST 至少返回 `auth_failed`、`timeout`、`element_not_found`、`nav_failed`、`extract_failed`、`bridge_down`、`generic`。当失败上下文显式提供合法 `heal_context` 时，系统 MUST 优先使用该类型；否则 MUST 根据 error、step id 和 tool name 分类。

#### Scenario: 显式 heal context 优先
- **WHEN** 输入错误信息为 `"unknown"`，失败步骤包含 `heal_context: "extract_failed"`
- **THEN** self-heal 返回错误类型 `extract_failed`

#### Scenario: bridge 不可达分类
- **WHEN** 输入错误信息包含 `"connection refused"` 或 `"bridge"`
- **THEN** self-heal 返回错误类型 `bridge_down`

#### Scenario: execute_script 分类
- **WHEN** tool name 为 `execute_script` 且没有显式 heal context
- **THEN** self-heal 返回错误类型 `extract_failed`

### Requirement: Known issues zero-token match
系统 SHALL 读取 `learnings/known_issues.json` 并支持已解决问题的 0 tokens 命中。命中规则 MUST 与 Python 兼容：只考虑 `resolved: true` 的 issue；当 `pattern` 是错误信息子串，或 `flow_id` 与 `step_id` 同时匹配时，系统 MUST 返回该 issue 并允许调用方跳过 Agent 触发。

#### Scenario: pattern 子串命中
- **WHEN** `known_issues.json` 中存在 `resolved: true` 且 `pattern` 为 `"selector changed"`，当前错误信息包含 `"selector changed at table"`
- **THEN** self-heal 返回该 known issue

#### Scenario: 未解决问题不命中
- **WHEN** `known_issues.json` 中存在 `resolved: false` 的 issue
- **THEN** self-heal 不将该 issue 作为 0 tokens 命中结果返回

#### Scenario: 文件不存在
- **WHEN** `learnings/known_issues.json` 不存在
- **THEN** self-heal 返回无命中且不抛出异常

### Requirement: Heal prompt and context rendering
系统 SHALL 根据失败输入生成 heal context JSON 与 prompt Markdown 文件。context 文件 MUST 写入 `data/logs/heals/<heal_id>.json`，prompt 文件 MUST 写入 `data/logs/heals/<heal_id>_prompt.md`。context MUST 可由 `HealContextSchema` 解析。prompt MUST 包含 flow id、flow name、step id、tool name、error type、错误摘要、运行参数、失败步骤入参、heal context 文件路径和流程 `heal.hints`。

#### Scenario: dry-run 生成文件
- **WHEN** 调用 `triggerHeal()` 且 `dryRun: true`
- **THEN** 系统写入 heal context 与 prompt 文件，并返回 `dry_run: true`、`prompt_path`、`heal_log_path` 和 `error_type`

#### Scenario: safe placeholder rendering
- **WHEN** 模板中包含未知占位符 `{missing_value}`
- **THEN** prompt 渲染保留 `{missing_value}`，不会因为缺失字段失败

#### Scenario: context schema compatible
- **WHEN** self-heal 写入 `data/logs/heals/<heal_id>.json`
- **THEN** 该 JSON 能通过 `HealContextSchema` 解析，并保留未知兼容字段

### Requirement: Template lookup precedence
系统 SHALL 按 Python 兼容顺序查找提示词模板：`heal_templates/<flow_id>/<error_type>.md`、`heal_templates/<flow_id>/generic.md`、`heal_templates/<error_type>.md`、`heal_templates/generic.md`、内置 fallback。系统 MUST 在读取模板失败或模板不存在时继续尝试下一个候选。

#### Scenario: flow-specific error template wins
- **WHEN** 同时存在 `heal_templates/orders/extract_failed.md` 与 `heal_templates/generic.md`
- **THEN** flow id 为 `orders` 且 error type 为 `extract_failed` 时使用 flow-specific error template

#### Scenario: global generic fallback
- **WHEN** 不存在 flow-specific template，但存在 `heal_templates/generic.md`
- **THEN** self-heal 使用 global generic template

#### Scenario: builtin fallback
- **WHEN** `heal_templates/` 中没有可用模板
- **THEN** self-heal 使用内置 fallback 生成 prompt

### Requirement: Cooldown and heal event log
系统 SHALL 读取并追加 `learnings/heals.jsonl`，用于冷却和频控。系统 MUST 支持 `cooldown_minutes` 与 `max_per_day`；同一 `flow_id + step_id` 在冷却期内重复触发 MUST 返回 skipped；同一 flow 当天触发次数达到上限 MUST 返回 skipped；触发、跳过、Agent 失败和超时 MUST 追加结构化事件。

#### Scenario: same step cooldown
- **WHEN** `learnings/heals.jsonl` 中最近一次 `triggered` 事件属于同一 `flow_id + step_id` 且在 `cooldown_minutes` 内
- **THEN** `triggerHeal()` 返回 `skipped: true` 并追加 skipped 事件

#### Scenario: daily max reached
- **WHEN** 同一 flow 当天已有 `max_per_day` 条 `triggered` 事件
- **THEN** `triggerHeal()` 返回 `skipped: true`，reason 指出今日自愈已达上限

#### Scenario: dry-run does not consume quota
- **WHEN** 调用 `triggerHeal()` 且 `dryRun: true`
- **THEN** 系统不追加 `triggered` 事件，也不消耗 cooldown 或 daily quota

### Requirement: Agent CLI adapter
系统 SHALL 提供可注入的 Agent CLI adapter。默认 command adapter MUST 根据配置渲染命令占位符 `{prompt}`、`{prompt_path}`、`{session_key}`、`{flow_id}`、`{heal_id}`，MUST 支持 timeout，MUST 将非零 exit code、timeout、command missing 转为结构化结果。默认测试 MUST 使用 mock runner，不得实际调用 OpenClaw/Claude/Cursor。

#### Scenario: mock runner success
- **WHEN** 测试使用 mock `AgentRunner` 返回 exit code 0
- **THEN** `triggerHeal()` 返回 `success: true`，并追加 `triggered` 事件

#### Scenario: runner non-zero exit
- **WHEN** `AgentRunner` 返回非零 exit code 和 stderr
- **THEN** `triggerHeal()` 返回 `success: false`，并在事件中记录 `cli_exit_code` 和截断后的 stderr

#### Scenario: runner timeout
- **WHEN** `AgentRunner` 在配置的 timeout 内未完成
- **THEN** `triggerHeal()` 返回 `success: false` 和 timeout error，并追加结构化事件

### Requirement: Flow-engine failure metadata input
系统 SHALL 支持从 `packages/flow-engine` 的失败结果 metadata 组装 self-heal 输入。输入 MUST 保留 `flow_id`、flow name、`failed_step.step_id`、`failed_step.tool`、`failed_step.action`、`failed_step.args`、`failed_step.heal_context`、`error`、`store_id`、`target_id` 和 params。该适配 MUST 不要求 `packages/flow-engine` 在 M4 依赖 `packages/self-heal`。

#### Scenario: build input from failed run
- **WHEN** flow-engine 返回 `status: "failed"` 且包含 `failed_step` 和 `heal` metadata
- **THEN** self-heal 能组装出完整 `HealTriggerInput` 并生成 prompt

#### Scenario: missing failed step
- **WHEN** 失败结果缺少 `failed_step`
- **THEN** self-heal 使用 `unknown` step/tool 占位生成 prompt，而不是抛出非预期异常
