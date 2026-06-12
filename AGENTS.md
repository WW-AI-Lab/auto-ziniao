# AGENTS.md — Agent 工作守则

本仓库是「紫鸟自动化引擎」：把跑通的紫鸟店铺操作任务沉淀为 0 tokens 可重复执行的流程，异常时自动触发 Agent 自愈。你（Agent）在这个仓库工作时必须遵守以下规则。

## 最高安全规则（违反即严重事故）

**所有浏览器操作只能通过紫鸟 ZClaw bridge 执行，绝对禁止使用本机浏览器。**

- 唯一合法通道：`POST http://127.0.0.1:9481/zclaw/tools/invoke`（认证头 `X-ZClaw-Api-Key`，key 在 `~/.zclaw/config.json`）。工具发现：`GET /zclaw/tools`（免认证）。
- 打开页面只有两种方式：店铺已开用 `visit_page`；未开用 `open_store`（可带 `launchUrl`）。店铺浏览器由紫鸟客户端自行拉起——它是 Chromium 内核，外观像 Chrome，但走店铺独立 IP 环境，**这不是本机浏览器**。
- 禁止：打开 Chrome/Safari/Edge/Firefox、使用 Playwright/Selenium/Puppeteer/browser-use、调用 `webbrowser` 模块、`open <url>` 命令。
- 工具名以 `GET /zclaw/tools` 返回为准（当前 20 个），**禁止臆造**（没有 `navigate`/`open_url`/`run_script`/`screenshot` 这类名字）。
- 代码层守卫：`engine/zclaw_client.py` 的 `_request()` 路径白名单（仅 `/zclaw/*`）是硬约束，**禁止修改或绕过**。
- bridge 不可达（连接拒绝/超时）= 紫鸟客户端没开，属于环境问题：停止任务并告知用户，不要改代码绕过，不要换浏览器方案。

## 你在本仓库的三种工作模式

### 模式 A：沉淀新任务（用户说"把 XX 任务固化/沉淀下来"）

1. 先用 ziniao-assistant skill 真机跑通任务（探索阶段允许逐步调用 bridge 工具）。
2. 跑通后执行 `python3 manager.py new <flow_id> <中文名>` 创建脚手架。
3. 按 `docs/03-流程定义规范.md` 填写流程，硬性要求：
   - 声明 `params`（至少 `store_name`），不得硬编码店铺名/日期；
   - 提取 JS 外置到 `extracts/<名称>.js`，IIFE 包裹，`return JSON.stringify(...)`，禁用 JS 模板字符串 `` `${}` ``；
   - 关键提取步骤配 `validate`（防空数据假成功）；
   - 可能失败的步骤配 `on_fail`：瞬时问题（加载慢）用 `retry`，页面结构问题用 `heal` 并标注 `context` 错误类型；
   - 有状态差异的场景用 `branch` 写多分支（如已登录/未登录、有数据/无数据、已是目标状态）；
   - **必须**填写 `heal.hints`：页面入口、关键选择器、页面结构特征、已知坑——这是给未来自愈 Agent 的提示词素材。
4. 验收：`python3 manager.py validate <flow_id>` 通过 → `python3 manager.py run <flow_id> -v --no-heal` 真机跑通 → 检查 `data/output/` 产出正确。
5. 复杂流程可追加 `heal_templates/<flow_id>/<error_type>.md` 定制自愈提示词。

### 模式 B：自愈修复（你被 engine/self_heal.py 的提示词唤起）

1. 读提示词中的失败上下文（`data/logs/heals/<heal_id>.json`）、流程定义、截图。
2. 通过 ZClaw bridge 复现诊断（截图/读 DOM/试选择器）。
3. 修复 `flows/<id>.json` 或 `extracts/*.js`（version +1），**不要**修改引擎代码来掩盖流程问题。
4. 验证：`python3 manager.py validate <id>` → `python3 manager.py run <id> -v --no-heal` 必须真实跑通。
5. 固化：把修复写入 `learnings/known_issues.json`（pattern 取错误信息中稳定子串，`resolved: true`）。
6. 通知用户：根因、修复内容、验证结果。

### 模式 C：日常操作（执行/排查）

- 执行：`python3 manager.py run <flow> [-p k=v]...`；重试：`manager.py retry <flow>`。
- 排查：`manager.py history` / `manager.py heals` / `manager.py stats`；bridge 日志用 `get_logs` 工具。
- 多个同类子项（多种订单类型/报表）要逐个检查，不得从子集推断整体。

## 仓库地图

| 路径 | 作用 | 修改约束 |
|------|------|----------|
| `manager.py` | 管理 CLI 入口（转发 `engine/manager.py`，命令不变） | - |
| `engine/zclaw_client.py` | 唯一网络出口（含安全白名单） | 白名单禁止动 |
| `engine/flow_engine.py` | 流程引擎 | 修流程问题时不要改它 |
| `engine/self_heal.py` | 自愈触发器 | 模板尽量放文件，少改内置 |
| `engine/paths.py` | 全仓路径常量唯一出处 | 目录调整需同步文档 |
| `config.json` | 自愈 Agent CLI/冷却/告警 | 用户级配置，改前确认 |
| `flows/*.json` | 沉淀的流程（`_template.json` 是模板） | 改后必须 validate + 真机验证 |
| `extracts/*.js` | 页面提取 JS | IIFE；禁模板字符串 |
| `heal_templates/` | 自愈提示词模板 | 可按流程加子目录定制 |
| `learnings/known_issues.json` | 已知问题库（0 tokens 修复路径） | 修复后必须回写 |
| `data/` | 运行时数据（logs/output/backups/webadmin.db） | 只读，勿手工编辑 |
| `webadmin/` | Web 管理界面（可选子工程） | 引擎主体禁止 import 它 |
| `docs/` | 架构与规范文档 | 架构变更需同步更新 |

## 通用约定

- 本仓库零第三方依赖，新代码只用 Python 标准库；不要引入 requests/playwright 等。
- 所有文档、注释、提示词使用中文。
- `list_stores` 只调一次拿数据，不要循环轮询；`open_store` 一次即可。
- 流程失败时引擎已自动处理自愈触发，不要在流程外再包一层重试脚本。
- 临时数据文件允许，**禁止创建额外的可执行脚本文件**来绕过引擎完成任务（与 ziniao-assistant skill 的约定一致）。
