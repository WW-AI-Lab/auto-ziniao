## Why

TS 迁移已经完成 M1-M6，仓库具备 TypeScript flow engine、self-heal、`ziniao` CLI 和 `apps/webadmin-api` 的替代能力，但当前生产入口、文档、WebAdmin 旧后端、baseline 脚本和 Agent skill 仍大量指向 Python。只要这些入口继续存在，项目就不能达成 `docs/05-TS重构技术蓝图.md` 中“完全去除 Python 依赖”的目标，也会让后续维护继续在 Python/TS 双栈之间分裂。

本变更规划 M7：在前置的 WebAdmin 前端整理、双跑验证和入口切换 change 已完成后，移除或归档 Python engine、FastAPI WebAdmin 后端及所有 Python 运行依赖，把日常执行、调度、沉淀、自愈修复、WebAdmin 和 Agent skill 全部切换到 TS 命令与 TS 服务。M7 完成后，仓库内不再存在生产或验证所需的 Python 代码路径，但 `flows/`、`extracts/`、`heal_templates/`、`learnings/` 和 `data/` 的长期契约继续可用。

## What Changes

- **BREAKING**: 移除 `python3 manager.py ...` 生产入口，日常命令统一为 `pnpm ziniao ...` 或构建后的 `ziniao ...`。
- **BREAKING**: 移除或归档 `manager.py`、`engine/*.py`、`webadmin/**/*.py`、`webadmin/requirements.txt`、Python WebAdmin 测试和 Python 虚拟环境说明。
- **BREAKING**: `pnpm validate:baseline` 不再运行 Python 校验；改为 TS schema/flow-engine/CLI/WebAdmin API/安全扫描/迁移后命令 smoke 验证。
- 将 crontab 建议、README、AGENTS、docs、OpenSpec specs 和 ziniao-assistant skill 中的 Python 命令全部切换到 `ziniao` 命令。
- 将 WebAdmin 生产链路切到 `apps/webadmin-api` + 已整理后的 `apps/webadmin-frontend` dist；删除 FastAPI WebAdmin 后端。
- 扩展安全扫描，阻断新增 `.py` 源码、`requirements.txt`、Python subprocess 入口和回退到 Python CLI 的逻辑。
- 保留并验证现有 flow/runtime 数据契约：`flows/*.json`、`extracts/*.js`、`data/logs/runs.jsonl`、`data/output/`、`data/logs/heals/*`、`learnings/*.jsonl/json`。

## Capabilities

### New Capabilities

- `python-runtime-removal`: 覆盖 M7 后仓库 TS-only 运行态、Python 文件/依赖清零、命令面切换、文档/skill/crontab 更新、安全扫描和回滚归档要求。

### Modified Capabilities

- `typescript-cli`: `ziniao` 从过渡入口升级为生产入口，命令语义、crontab 输出和自愈触发不再引用 `python3 manager.py`。
- `typescript-webadmin-api`: WebAdmin API 从并行能力升级为 WebAdmin 生产后端，托管整理后的前端 dist，并删除 FastAPI 后端依赖。
- `typescript-workspace-baseline`: workspace 从 Python/TS 并行基线切换为 TS-only 基线，默认验证不再依赖 Python。
- `flow-compatibility-baseline`: 兼容性基线从“TS 与 Python 静态校验对比”切换为“归档的 Python 双跑证据 + TS golden/fixture 回归 + 显式真实 bridge smoke”。

## Architecture Impact

- 复用既有 TS 包边界：`packages/zclaw` 仍是唯一 TS ZClaw bridge 出口；`packages/flow-engine` 只通过 tool client 调度工具；`packages/self-heal` 不访问 bridge；`packages/cli` 只做命令编排；`apps/webadmin-api` 只做 WebAdmin API/SSE/调度/静态托管编排。
- 依赖前置阶段：`apps/webadmin-frontend` 整理、API 类型复用、Python/TS CLI 双跑、Python/TS WebAdmin 双跑和入口切换必须先完成并有记录。若前置证据缺失，M7 apply 必须停止，不得直接删除 Python。
- 影响现有规格：`typescript-cli`、`typescript-webadmin-api`、`typescript-workspace-baseline`、`flow-compatibility-baseline` 需要更新从“过渡/并行”到“TS-only 生产”的要求。
- 影响配置与部署：root `package.json` scripts、`pnpm-workspace.yaml`、`tsconfig` references、WebAdmin 启动方式、crontab 示例、Agent skill 文档、README/AGENTS/docs 都需要统一。
- 安全边界不放松：禁止本机浏览器、Playwright/Selenium/Puppeteer/browser-use；真实浏览器操作仍只能通过 ZClaw bridge；baseline 仍不得调用真实 bridge 或真实 Agent CLI。

## Impact

- 代码：`manager.py`、`engine/`、`webadmin/` Python 后端、`scripts/validate-python-flows.ts`、root scripts、TS CLI/WebAdmin API、security scan、测试。
- 文档与操作面：`README.md`、`AGENTS.md`、`docs/`、`.cursor/skills/ziniao-assistant/`、`.codex/skills/`、OpenSpec specs、crontab 输出和使用示例。
- 数据与资产：保留 `flows/`、`extracts/`、`heal_templates/`、`learnings/`、`data/` 的格式和读写位置。
- 部署与验证：本地生产服务改由 Node/TS 启动；回滚不再是“继续使用 Python 生产入口”，而是通过归档分支/tag 或恢复本 change 删除内容。
