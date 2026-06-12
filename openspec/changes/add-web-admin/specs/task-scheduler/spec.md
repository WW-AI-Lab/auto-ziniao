# task-scheduler — 独立计划任务

## ADDED Requirements

### Requirement: 计划任务 CRUD
系统 SHALL 提供计划任务的创建、列表、查看、修改、删除与启用/停用 API。任务定义 MUST 持久化到 SQLite `schedules` 表，字段至少包含：名称、目标 flow_id、运行参数（键值对）、触发方式与触发配置、启用状态、创建/更新时间、下次运行时间。

#### Scenario: 创建任务
- **WHEN** 客户端 `POST /api/schedules` 提交 `{name, flow_id, params, trigger}` 且 flow_id 存在、触发配置合法
- **THEN** 任务落库，响应包含计算出的下次运行时间

#### Scenario: 创建任务引用不存在的 flow
- **WHEN** 提交的 `flow_id` 在 `flows/` 中不存在
- **THEN** 返回 HTTP 400，任务不落库

#### Scenario: 停用任务
- **WHEN** 客户端将任务 `enabled` 置为 false
- **THEN** 调度器不再触发该任务，任务记录保留

### Requirement: 三种触发方式
触发方式 SHALL 支持三种：`interval`（固定间隔分钟数）、`daily`（每日 HH:MM）、`cron`（五字段表达式：分 时 日 月 周，支持 `*`、`*/n`、`a-b`、`a,b` 语法子集）。创建/修改时 MUST 校验触发配置合法性，不支持的 cron 写法返回错误。

#### Scenario: interval 触发
- **WHEN** 任务配置 `{"type": "interval", "minutes": 60}`
- **THEN** 每 60 分钟触发一次，下次运行时间为上次触发时间加 60 分钟

#### Scenario: daily 触发
- **WHEN** 任务配置 `{"type": "daily", "time": "08:30"}`
- **THEN** 每天 08:30（本机时区）触发一次

#### Scenario: 非法 cron 表达式
- **WHEN** 任务配置 cron 为 `0 8 * * MON#2`（不支持的语法）
- **THEN** 创建请求返回 HTTP 400，错误信息说明支持的语法子集

### Requirement: 调度执行与并发防重
调度器 SHALL 以后台线程运行，周期性（不超过 30 秒一次）扫描启用任务并在到点时通过 subprocess 执行 `python3 flow_engine.py run <flow_id> [-p k=v]...`。同一 flow MUST 持有进程内锁：已有运行中实例（无论调度触发还是手动触发）时本次调度 SHALL 跳过并记录 skipped。flow 子进程 SHALL 有超时上限（默认 30 分钟），超时强制终止并记为失败。调度器线程异常 MUST 被捕获并自动恢复循环。

#### Scenario: 到点执行
- **WHEN** 任务下次运行时间到达且对应 flow 无运行中实例
- **THEN** 调度器启动 flow 子进程，并更新任务的下次运行时间

#### Scenario: 并发防重
- **WHEN** 任务到点但同一 flow 正在运行（手动或其他任务触发）
- **THEN** 本次触发跳过，调度历史记录一条 `skipped` 并注明原因

#### Scenario: 服务重启后恢复调度
- **WHEN** webadmin 服务重启
- **THEN** 调度器根据库中任务定义重新计算下次运行时间并继续调度（错过的触发不补跑）

### Requirement: 调度历史
每次触发（执行、跳过、失败、超时）SHALL 写入 SQLite `schedule_runs` 表，字段至少包含：任务 id、触发时间、结果状态、flow 退出码、耗时、错误摘要。系统 SHALL 提供按任务查询调度历史的 API（分页、倒序）。

#### Scenario: 查看任务历史
- **WHEN** 客户端请求 `GET /api/schedules/<id>/runs?limit=20`
- **THEN** 返回该任务最近 20 条触发记录，含状态与耗时

#### Scenario: 执行失败留痕
- **WHEN** 调度触发的 flow 子进程以非零退出码结束
- **THEN** 调度历史记录 `failed` 与错误摘要；flow 自身的自愈链路由引擎照常处理，调度器不额外重试
