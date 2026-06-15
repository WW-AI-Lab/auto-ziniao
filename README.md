# 紫鸟自动化引擎

把 Agent（OpenClaw / Claude Code 等）跑通的紫鸟店铺操作任务**沉淀**为 0 tokens、可传参重复执行的流程；执行异常时**自动触发 Agent CLI 自愈**，修复方案回写知识库，越用越省。

> **最高安全规则：所有浏览器操作只通过紫鸟 ZClaw bridge（`127.0.0.1:9481/zclaw/*`）在紫鸟店铺浏览器内执行，绝对禁止使用本机浏览器或 Playwright/Selenium 等框架。** 代码层面由 `engine/zclaw_client.py` 的路径白名单强制保证。

## 快速开始

```bash
# 0. 前置：紫鸟浏览器客户端已启动（bridge 随客户端运行在 9481 端口），
#    API key 已配置在 ~/.zclaw/config.json（{"ZCLAW_API_KEY": "znoc_..."}）

# 1. 查看已沉淀的流程
python3 manager.py list

# 2. 执行流程（支持传参）
python3 manager.py run orders_overview
python3 manager.py run switch_language -p target_lang=en-US -p store_name=前行信息

# 3. 查看历史与统计
python3 manager.py history
python3 manager.py stats
```

引擎主体零第三方依赖，Python 3.9+（macOS 自带）即可运行。（Web 管理界面为可选子工程，依赖独立安装，见下文。）

## TypeScript 迁移基线（开发中）

当前已完成 `docs/05-TS重构技术蓝图.md` 的 M6：WebAdmin 后端 TS 化。根目录 pnpm workspace 已包含 `packages/core`、`packages/schemas`、`packages/zclaw`、`packages/flow-engine`、`packages/self-heal`、`packages/cli` 和 `apps/webadmin-api`：

- `packages/core`：路径、JSON/JSONL、时间、错误类型等无浏览器副作用能力。
- `packages/schemas`：flow DSL、运行日志、自愈记录和 WebAdmin DTO 的 TypeScript schema。
- `packages/zclaw`：TypeScript 侧唯一 ZClaw bridge client，负责 API key 读取、`/zclaw/*` 路径白名单、`GET /zclaw/tools`、`POST /zclaw/tools/invoke` 和最小高级封装。
- `packages/flow-engine`：TypeScript flow loader、静态校验 wrapper、参数/变量/分支/validate/action 执行语义、mock ZClaw tool dispatch、output 和 run log 兼容写入。
- `packages/self-heal`：TypeScript 自愈包，提供错误分类、known issues 命中、prompt/context 生成、cooldown、Agent CLI adapter、dry-run 和 mock runner 离线测试。
- `packages/cli`：TypeScript 过渡 CLI，提供 `ziniao ...` 命令并聚合 flow-engine 与 self-heal。
- `apps/webadmin-api`：TypeScript WebAdmin 后端，提供 Fastify REST/SSE API、SQLite WebAdmin 自有状态、调度器、chat SSE 与静态前端 dist 托管。

```bash
pnpm install
pnpm validate:baseline
```

注意：现阶段 TypeScript 已具备 flow-engine 离线执行、self-heal dry-run、`ziniao ...` 过渡 CLI、TS WebAdmin API 和双跑验证基础能力，但还不是生产执行入口。`pnpm validate:baseline` 使用 mock tool client、mock Agent runner、临时数据目录、固定 clock 和 no-op sleeper，不得调用真实 `POST /zclaw/tools/invoke`，不得执行真实店铺 flow，不得调用真实 OpenClaw/Claude/Cursor Agent CLI，也不要求紫鸟客户端在线。日常运行、沉淀、自愈仍使用：

```bash
python3 manager.py ...
```

`ziniao ...` 当前用于 M5 过渡验证和后续双跑切换准备，示例：

```bash
pnpm ziniao --help
pnpm ziniao list
pnpm ziniao validate orders_overview
pnpm ziniao run webadmin_selftest -p greeting=hello --no-heal
```

M6 完成后仍不替换 `python3 manager.py ...`，不移除 Python engine，也不移动当前 WebAdmin 前端。下一阶段是 `apps/webadmin-frontend` 整理与 WebAdmin 双跑切换准备。

回滚方式很直接：停止使用 TS 校验命令，删除根级 Node workspace 文件、`packages/` 与 `apps/webadmin-api` 即可；Python 引擎、`flows/`、`extracts/` 和历史数据不需要迁移回滚。若只回滚 M6，删除 `apps/webadmin-api` 并恢复 root scripts、TS alias、workspace 与 security scan 改动即可。回滚后验证 `python3 manager.py list` 和 `python3 manager.py validate orders_overview`。

### TypeScript WebAdmin API（M6，过渡能力）

`apps/webadmin-api` 是 TS WebAdmin 后端能力，不替换当前 Python WebAdmin 生产链路。开发启动：

```bash
pnpm webadmin:api
# 默认 http://127.0.0.1:9482
```

边界：

- 只监听 `127.0.0.1`，代码不提供 `0.0.0.0` 绑定开关。
- 不直接访问 ZClaw bridge，不读取 ZClaw API key，不打开本机浏览器。
- 默认测试使用 mock tool client、mock Agent runner、临时 data root，不执行真实 flow。
- 静态前端仍托管当前 `webadmin/frontend/dist`；本阶段不创建 `apps/webadmin-frontend`。
- SQLite 使用 Node 24 内置 `node:sqlite`。原因是当前 pnpm 安装策略阻止 native build script，`better-sqlite3` binding 不可用；该替代符合 M6 design 的 native addon 风险回退方案。

## Web 管理界面（可选）

`webadmin/` 提供本机 Web 前后端管理：流程查看/编辑/运行、独立计划任务、运行与自愈观测、产出浏览、Agent 对话（OpenClaw gateway / agent CLI）。

```bash
# 安装（独立依赖，不影响引擎主体）
python3 -m venv .venv && .venv/bin/pip install -r webadmin/requirements.txt

# 启动后访问 http://127.0.0.1:9482（端口可在 config.json 加 "webadmin": {"port": ...} 覆盖）
.venv/bin/python -m webadmin
```

注意事项：

- **安全边界**：服务仅监听 `127.0.0.1`，无登录。代码不提供改绑 `0.0.0.0` 的开关，也请勿通过反向代理将其暴露到局域网/公网。
- **调度防重**：webadmin 的计划任务与系统 crontab 是两套独立调度。某个 flow 接入 webadmin 计划任务后，请从 crontab 中移除对应条目，避免双调度并发执行同一流程。
- **Agent 对话**：agent 清单来自 `config.json` 的 `heal.agents`。openclaw 优先走 gateway 的 `/v1/chat/completions`（需在 `~/.openclaw/openclaw.json` 启用 `gateway.http.endpoints.chatCompletions.enabled: true`），未启用时自动回退 `openclaw agent` CLI。
- **回滚**：停止服务后删除 `webadmin/` 目录与 `data/webadmin.db` 即可完全移除，引擎与数据不受影响。

## 已沉淀的流程

| 流程 | 说明 | 参数 |
|------|------|------|
| `account_health` | 账户状况评级、政策合规检查 | `store_name` |
| `inventory_check` | 商品库存与在售状态 | `store_name` |
| `orders_overview` | 订单概览（待发货/濒临取消等） | `store_name` |
| `switch_language` | 站点语言检测与切换（带分支：已是目标语言则跳过） | `target_lang` `store_name` |

## 常用命令

```bash
python3 manager.py run <flow> [-p k=v]... [-v] [--no-heal]   # 执行（传参/详细/禁自愈）
python3 manager.py retry <flow>          # 重试上次失败（沿用上次参数）
python3 manager.py new <flow> [名称]     # 从模板创建新流程（沉淀脚手架）
python3 manager.py validate <flow>       # 静态校验流程定义
python3 manager.py heals                 # 查看自愈记录
python3 manager.py cron                  # 生成 crontab 配置建议
```

## 工作原理（三态闭环）

1. **沉淀**（一次性消耗 tokens）：Agent 用 ziniao-assistant skill 跑通任务后，按 `docs/03-流程定义规范.md` 固化为 `flows/*.json` + `extracts/*.js`，并写好自愈线索 `heal.hints`。
2. **常态执行**（0 tokens）：cron 或手动执行，纯脚本完成参数解析、分支选择、结果校验、本地重试。
3. **自愈**（仅异常时消耗 tokens）：失败 → 截图留现场 → 先查 `learnings/known_issues.json`（命中即停，0 tokens）→ 冷却/频控检查 → 组装提示词调用 Agent CLI（OpenClaw/Claude/Cursor，`config.json` 可配）→ Agent 修复验证后回写知识库。

## 目录速览

```
manager.py           管理 CLI 入口（转发 engine/manager.py，命令见上文）
engine/              核心引擎包（flow_engine / self_heal / zclaw_client / manager / paths）
config.json          自愈 Agent CLI、冷却、告警配置
flows/               流程定义（_template.json 为脚手架模板）
extracts/            页面提取 JS（IIFE）
heal_templates/      自愈提示词模板（可按流程定制）
learnings/           known_issues.json 知识库 + heals.jsonl 事件流
data/                运行时数据（logs/ output/ backups/ webadmin.db，gitignore）
webadmin/            Web 管理界面（可选子工程：FastAPI + React，独立依赖）
packages/            TypeScript 迁移包（core / schemas / zclaw / flow-engine / self-heal / cli，当前不替换生产入口）
apps/webadmin-api/   TypeScript WebAdmin 后端（M6 过渡能力，当前不替换 Python WebAdmin）
docs/                评审报告、架构设计、流程规范、自愈机制
AGENTS.md            Agent 工作守则（沉淀规范 + 安全规则）
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
