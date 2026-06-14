## 1. CLI Package Scaffold

- [x] 1.1 新增 `packages/cli` workspace 包，配置 `package.json`、`tsconfig.json`、`src/`、Vitest 测试入口和 `bin: { "ziniao": ... }`。
- [x] 1.2 在 root `package.json`、`tsconfig.base.json` 中接入 `packages/cli`，但不改变 `python3 manager.py ...` 入口语义。
- [x] 1.3 新增 `commander` 依赖，并确认未引入 Playwright/Selenium/Puppeteer/browser-use 或本机浏览器打开相关依赖。
- [x] 1.4 实现 CLI app 创建函数，支持测试注入 `repoRoot`、`dataRoot`、mock `FlowToolClient`、mock `AgentRunner`、clock、sleeper 和 stdout/stderr sink。

## 2. Flow Management Commands

- [x] 2.1 实现 `ziniao list`，读取非模板 flows，展示 id、名称、版本、启用状态、调度、最近运行摘要和参数摘要。
- [x] 2.2 实现 `ziniao validate <flow_id>`，复用 `@ziniao/flow-engine.validateFlow()`，按 fatal error 设置 exit code。
- [x] 2.3 实现 `ziniao new <flow_id> [name]`，复用 `flows/_template.json` 创建脚手架，拒绝覆盖已有 flow。
- [x] 2.4 实现 `ziniao enable <flow_id>` 与 `ziniao disable <flow_id>`，仅修改目标 flow 的 `enabled` 字段并保持 JSON 可读。
- [x] 2.5 增加 flow 管理命令单测：缺失 flow、缺失模板、拒绝覆盖、enable/disable 只影响目标文件、validate warning 不返回失败。

## 3. Run Commands

- [x] 3.1 实现 `ziniao run <flow_id> [-p k=v]... [-v] [--no-heal]`，复用 `parseParams()` 与 `runFlow()`，输出成功/失败摘要和稳定 exit code。
- [x] 3.2 实现 `ziniao run-all`，串行执行 enabled flows，跳过 disabled flows，并输出汇总结果。
- [x] 3.3 实现 `ziniao retry <flow_id>`，从最近一次 run log 读取 params 后重新调用 `run`；缺历史或上次已成功时给出兼容提示。
- [x] 3.4 增加 run 命令单测：本地 mock flow 成功、tool failure、validate failure、`--no-heal` 不触发 self-heal、`run-all` 串行和跳过 disabled。

## 4. Self-Heal Integration

- [x] 4.1 在 `run` 失败且未传 `--no-heal` 时，调用 `@ziniao/self-heal.buildTriggerInputFromFailure()` 和 `triggerHeal()`。
- [x] 4.2 增加 `--heal-dry-run` 或等价测试注入路径，便于离线验证 self-heal context/prompt 生成而不调用真实 Agent CLI。
- [x] 4.3 展示 self-heal 结果：heal id、prompt path、context path、known issue skip、cooldown skip、Agent failure/timeout。
- [x] 4.4 增加 self-heal CLI 单测：mock runner success、known issue skip、cooldown skip、runner non-zero、runner timeout、dry-run 不消耗 quota。

## 5. Observability Commands

- [x] 5.1 实现 `ziniao history [flow_id]`，读取 `data/logs/runs.jsonl`，支持缺文件、空日志、按 flow 过滤和最近记录展示。
- [x] 5.2 实现 `ziniao heals`，读取 `learnings/heals.jsonl`，支持缺文件、空日志和最近自愈事件展示。
- [x] 5.3 实现 `ziniao stats`，按最近 run log 计算总成功率、失败数、异常数和按 flow 成功率。
- [x] 5.4 实现 `ziniao cron`，基于 enabled 且有 `schedule` 的 flows 输出 crontab 建议，并明确 M5 仍未切换生产入口。
- [x] 5.5 增加观测命令单测：缺日志不报错、非法 JSONL 行跳过、stats 口径对齐、cron 不修改系统 crontab。

## 6. Safety and Baseline

- [x] 6.1 更新 `scripts/security-scan.ts`，阻断 `packages/cli` direct bridge 访问、ZClaw API key 读取、本机浏览器打开命令和浏览器自动化依赖。
- [x] 6.2 将 `packages/cli` 纳入 `pnpm typecheck`、`pnpm test`、`pnpm build` 和 `pnpm validate:baseline`。
- [x] 6.3 增加精确边界检查记录：`rg -n "9481|/zclaw/tools|/zclaw/" packages/cli/src` 无命中。
- [x] 6.4 增加 CLI 离线兼容测试，覆盖 `list`、`validate`、`run --no-heal`、失败后 mock self-heal、`run-all`、`retry`、`new`、`enable`、`disable`、`history`、`heals`、`stats`、`cron`。
- [x] 6.5 确认所有 CLI baseline 使用 mock tool client、临时 data root、no-op sleeper、fixed clock 和 mock Agent runner，不调用真实 bridge 或真实 Agent CLI。

## 7. Documentation and Roadmap

- [x] 7.1 更新 `docs/06-TS迁移进度与路线图.md`，将 M5 从 proposal 状态推进为实现中/已完成状态，并记录验证结果。
- [x] 7.2 更新 README 的 CLI 章节，说明 `ziniao ...` 是 M5 过渡入口，生产入口仍为 `python3 manager.py ...` 直到双跑切换完成。
- [x] 7.3 更新 AGENTS.md 的 TS 迁移边界，说明 M5 已允许 `packages/cli`，但仍禁止迁移 WebAdmin、替换 Python engine 或执行真实 baseline。
- [x] 7.4 如 `add-typescript-flow-pacing-policy` 已先落地，补充说明 CLI 只消费 flow-engine pacing 能力，不在 CLI 内重复实现。

## 8. Architecture Verification

- [x] 8.1 运行 `pnpm typecheck`，确认 CLI 与既有 TS 包类型检查通过。
- [x] 8.2 运行 `pnpm test`，确认 CLI、flow-engine、self-heal、schema 测试通过。
- [x] 8.3 运行 `pnpm build`，确认 `packages/cli` 与 workspace build 通过。
- [x] 8.4 运行 `pnpm validate:baseline`，确认 CLI 纳入离线基线且不要求紫鸟客户端在线。
- [x] 8.5 运行 `pnpm security:scan`，确认 CLI 没有 direct bridge、本机浏览器或受禁依赖。
- [x] 8.6 运行 `python3 manager.py list` 与 `python3 manager.py validate orders_overview`，确认 Python 生产入口未被破坏。
- [x] 8.7 运行 `openspec validate add-typescript-cli --strict`，确认 proposal/design/specs/tasks 可进入 apply 阶段。
- [x] 8.8 记录回滚方式：删除或隔离 `packages/cli`，恢复 root workspace 配置、安全扫描和文档中的 M5 改动后，Python 入口仍可运行。
