# 紫鸟自动化引擎

把 Agent（OpenClaw / Claude Code 等）跑通的紫鸟店铺操作任务**沉淀**为 0 tokens、可传参重复执行的流程；执行异常时**自动触发 Agent CLI 自愈**，修复方案回写知识库，越用越省。

> **最高安全规则：所有浏览器操作只通过紫鸟 ZClaw bridge（`127.0.0.1:9481/zclaw/*`）在紫鸟店铺浏览器内执行，绝对禁止使用本机浏览器或 Playwright/Selenium 等框架。** 代码层面由 `packages/zclaw` 的路径白名单强制保证。

## 快速开始

```bash
# 0. 前置：紫鸟浏览器客户端已启动（bridge 随客户端运行在 9481 端口），
#    API key 已配置在 ~/.zclaw/config.json（{"ZCLAW_API_KEY": "znoc_..."}）
#    Node.js >= 22 + pnpm

pnpm install

# 1. 查看已沉淀的流程
pnpm ziniao list

# 2. 执行流程（支持传参）
pnpm ziniao run orders_overview
pnpm ziniao run switch_language -p target_lang=en-US -p store_name=前行信息

# 3. 查看历史与统计
pnpm ziniao history
pnpm ziniao stats
```

## WebAdmin 管理界面

`apps/api` 提供本机 Web 前后端管理：流程查看/编辑/运行、独立计划任务、运行与自愈观测、产出浏览、Agent 对话（OpenClaw gateway / agent CLI）。

```bash
# 构建前端（首次或前端有改动时）
pnpm web:build

# 启动后访问 http://127.0.0.1:9482
pnpm api
```

前端开发模式：

```bash
pnpm web
# Vite dev server 通过 /api proxy 到 http://127.0.0.1:9482
```

边界：

- 只监听 `127.0.0.1`，代码不提供 `0.0.0.0` 绑定开关。
- 不直接访问 ZClaw bridge，不读取 ZClaw API key，不打开本机浏览器。
- 默认测试使用 mock tool client、mock Agent runner、临时 data root，不执行真实 flow。
- 静态前端默认托管 `apps/web/dist`；缺失 dist 时 API 仍可用并返回结构化提示。
- 调度防重：webadmin 的计划任务与系统 crontab 是两套独立调度。某个 flow 接入 webadmin 计划任务后，请从 crontab 中移除对应条目。
- Agent 对话：agent 清单来自 `config.json` 的 `heal.agents`。

## 已沉淀的流程

| 流程 | 说明 | 参数 |
|------|------|------|
| `account_health` | 账户状况评级、政策合规检查 | `store_name` |
| `inventory_check` | 商品库存与在售状态 | `store_name` |
| `orders_overview` | 订单概览（待发货/濒临取消等） | `store_name` |
| `switch_language` | 站点语言检测与切换（带分支：已是目标语言则跳过） | `target_lang` `store_name` |

## 常用命令

```bash
pnpm ziniao run <flow> [-p k=v]... [-v] [--no-heal]   # 执行（传参/详细/禁自愈）
pnpm ziniao retry <flow>          # 重试上次失败（沿用上次参数）
pnpm ziniao new <flow> [名称]     # 从模板创建新流程（沉淀脚手架）
pnpm ziniao validate <flow>       # 静态校验流程定义
pnpm ziniao heals                 # 查看自愈记录
pnpm ziniao cron                  # 生成 crontab 配置建议
```

## 开发与验证

```bash
pnpm typecheck              # 类型检查
pnpm test                   # 运行所有测试
pnpm build                  # 编译所有包
pnpm schemas:export -- --check  # 校验 JSON Schema 是否最新
pnpm security:scan          # 安全扫描
pnpm validate:baseline      # 运行完整验证基线（以上全部）
```

## 工作原理（三态闭环）

1. **沉淀**（一次性消耗 tokens）：Agent 用 ziniao-assistant skill 跑通任务后，按 `docs/03-流程定义规范.md` 固化为 `flows/*.json` + `extracts/*.js`，并写好自愈线索 `heal.hints`。
2. **常态执行**（0 tokens）：cron 或手动执行，纯脚本完成参数解析、分支选择、结果校验、本地重试。
3. **自愈**（仅异常时消耗 tokens）：失败 → 截图留现场 → 先查 `learnings/known_issues.json`（命中即停，0 tokens）→ 冷却/频控检查 → 组装提示词调用 Agent CLI（OpenClaw/Claude/Cursor，`config.json` 可配）→ Agent 修复验证后回写知识库。

## 目录速览

```
packages/cli/            生产 ziniao CLI 入口
packages/zclaw/          唯一 ZClaw bridge 网络出口
packages/flow-engine/    Flow Engine（加载/校验/执行）
packages/self-heal/      自愈触发器
packages/core/           共享基础工具
packages/schemas/        契约类型与运行时校验
apps/api/                WebAdmin 后端（Fastify + SQLite）
apps/web/                WebAdmin 前端（React/Vite/antd）
config.json              自愈 Agent CLI、冷却、告警配置
flows/                   流程定义（_template.json 为脚手架模板）
extracts/                页面提取 JS（IIFE）
heal_templates/          自愈提示词模板（可按流程定制）
learnings/               known_issues.json 知识库 + heals.jsonl 事件流
data/                    运行时数据（logs/ output/ backups/ webadmin.db）
scripts/                 安全扫描等自动化脚本
docs/                    架构与规范文档
AGENTS.md                Agent 工作守则（沉淀规范 + 安全规则）
```

## 文档

| 文档 | 内容 |
|------|------|
| [docs/01-项目评审报告.md](docs/01-项目评审报告.md) | 历史问题评审与本次优化说明 |
| [docs/02-架构设计.md](docs/02-架构设计.md) | 整体架构、模块职责、数据流 |
| [docs/03-流程定义规范.md](docs/03-流程定义规范.md) | flow JSON 完整规范与沉淀 Checklist |
| [docs/04-自愈机制与提示词模板.md](docs/04-自愈机制与提示词模板.md) | 自愈链路、模板定制、Agent CLI 配置 |
| [docs/05-TS重构技术蓝图.md](docs/05-TS重构技术蓝图.md) | TypeScript/Node.js 分阶段迁移蓝图 |
| [docs/06-TS迁移进度与路线图.md](docs/06-TS迁移进度与路线图.md) | TS 迁移状态、边界、验收与后续路线图 |
| [docs/07-操作节奏与流程稳定性规划.md](docs/07-操作节奏与流程稳定性规划.md) | 操作节奏、限速、确认门槛与稳定性规划 |
| [AGENTS.md](AGENTS.md) | 给 Agent 的工作守则 |

## 回滚

Python 历史实现通过 git 恢复（M7 前恢复点：commit `68d7db8a`，branch `develop`）。
