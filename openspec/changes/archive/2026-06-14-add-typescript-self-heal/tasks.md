## 1. Package Scaffold

- [x] 1.1 创建 `packages/self-heal/package.json`、`tsconfig.json`、`src/index.ts` 和 `src/index.test.ts`，只依赖 `@ziniao/core`、`@ziniao/schemas` 与 Node 标准库。
- [x] 1.2 更新根级 `package.json`、`tsconfig.base.json`、`vitest.config.ts`，把 `packages/self-heal` 纳入 `build`、`typecheck`、`test` 和 `validate:baseline`。
- [x] 1.3 确认 `packages/self-heal` 不依赖 `@ziniao/zclaw`，不新增 Playwright/Selenium/Puppeteer/browser-use 等浏览器自动化依赖。

## 2. Shared Helpers and Runtime Contracts

- [x] 2.1 在 `packages/core` 中补充必要的通用文件 helper（如 `ensureDir`、`writeJsonFile`、`appendJsonLine`），保持 core 无浏览器副作用。
- [x] 2.2 复用并按需兼容扩展 `packages/schemas` 的 `HealContextSchema`、`HealEventSchema`、`KnownIssuesFileSchema`，确保历史字段可选且 `.passthrough()` 兼容。
- [x] 2.3 添加 schema/core 单测，验证 heal context、heal event、known issues 文件和 JSONL helper 的历史兼容性。

## 3. Self-Heal Core Logic

- [x] 3.1 实现 `classifyError()`，覆盖 `auth_failed`、`timeout`、`element_not_found`、`nav_failed`、`extract_failed`、`bridge_down`、`generic` 与显式 `heal_context` 优先级。
- [x] 3.2 实现 `checkKnownIssues()`，支持读取 `learnings/known_issues.json`、`resolved: true` 过滤、`pattern` 子串命中和 `flow_id + step_id` 命中。
- [x] 3.3 实现模板查找与 safe placeholder rendering，按 `heal_templates/<flow_id>/<error_type>.md` 到内置 fallback 的优先级生成 prompt。
- [x] 3.4 实现 heal context 与 prompt 文件写入，路径兼容 `data/logs/heals/<heal_id>.json` 与 `data/logs/heals/<heal_id>_prompt.md`。
- [x] 3.5 添加核心单测，覆盖错误分类、known issues 命中/不命中、模板优先级、未知 placeholder 保留和 context schema parse。

## 4. Cooldown, Config, and Agent Adapter

- [x] 4.1 实现 `loadHealConfig()`，兼容 Python 默认配置与 `config.json` 浅合并，仅读取不写入用户配置。
- [x] 4.2 实现 `checkCooldown()` 和 `learnings/heals.jsonl` 事件写入，覆盖 `cooldown_minutes`、`max_per_day`、同 step 冷却和同 flow 当日上限。
- [x] 4.3 实现 `AgentRunner` interface 与 command placeholder 渲染，支持 `{prompt}`、`{prompt_path}`、`{session_key}`、`{flow_id}`、`{heal_id}`。
- [x] 4.4 实现默认 command runner 的结构化结果，覆盖 success、non-zero exit、timeout、command missing 和 stderr 截断。
- [x] 4.5 实现 `triggerHeal()`，支持 dry-run、disabled、known issue skip、cooldown skip、mock runner trigger 和结构化返回。
- [x] 4.6 添加离线单测，使用临时 repo/data root、固定 clock、mock `AgentRunner`，确认 dry-run 不消耗 quota 且默认测试不调用真实 Agent CLI。

## 5. Flow-Engine Failure Metadata Integration

- [x] 5.1 定义 `HealTriggerInput` 与从 flow-engine failed result metadata 组装输入的 helper 或适配函数。
- [x] 5.2 添加集成单测，使用 M3 风格失败结果验证 `failed_step`、`heal_context`、`store_id`、`target_id`、params 和 error 被保留到 prompt/context。
- [x] 5.3 确认 M4 不让 `packages/flow-engine` 运行时依赖 `@ziniao/self-heal`；如需要类型复用，仅使用结构化兼容或 type-only import。

## 6. Security and Baseline Verification

- [x] 6.1 更新 `scripts/security-scan.ts`，确认 `packages/self-heal` 不进入 bridge allowlist，且扫描能区分静态 prompt 文本和可执行 direct bridge 访问。
- [x] 6.2 运行精确边界检查：`rg -n "9481|/zclaw/tools|/zclaw/" packages/self-heal/src`，确认不存在未授权 direct bridge 访问；如 prompt 文本需要例外，必须在扫描规则和测试中限制为非执行文本。
- [x] 6.3 运行 `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm security:scan`、`pnpm validate:baseline`。
- [x] 6.4 运行 Python 兼容验证：`python3 manager.py list`、`python3 manager.py validate orders_overview`，确认生产入口未受影响。
- [x] 6.5 运行 `openspec validate add-typescript-self-heal --strict`，修复所有 spec/task 问题。

## 7. Documentation and Roadmap

- [x] 7.1 更新 `docs/05-TS重构技术蓝图.md`，记录 M4 `packages/self-heal` 的职责、非目标、安全边界和后续 CLI 接入方式。
- [x] 7.2 更新 `docs/06-TS迁移进度与路线图.md`，把 M4 的实现状态、验证命令、已完成边界和下一步 M5 CLI 迁移写清楚。
- [x] 7.3 更新 README 与 `AGENTS.md`，同步 M4 完成后的包边界、禁止事项、默认离线验证和生产入口不变。
- [x] 7.4 在文档中记录 dry-run 输出位置、默认不调用真实 Agent CLI、以及 bridge 不可达时不得改用本机浏览器的边界。

## 8. Rollback Verification

- [x] 8.1 做 M4 回滚演练或等价验证：确认删除/隔离 `packages/self-heal` 与 root script/path alias/security scan 改动后，不影响 Python 生产链路。
- [x] 8.2 回滚验证后再次运行 `python3 manager.py list` 与 `python3 manager.py validate orders_overview`。
- [x] 8.3 在 `docs/06-TS迁移进度与路线图.md` 或 M4 验证记录中写明回滚方式和验证结果。
