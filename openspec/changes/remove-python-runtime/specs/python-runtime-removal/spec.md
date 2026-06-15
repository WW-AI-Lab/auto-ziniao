## ADDED Requirements

### Requirement: Python active tree removal
系统 SHALL 在 M7 完成后从 active tree 中移除所有生产、测试和验证所需的 Python 源码与依赖声明。仓库 tracked files MUST NOT 包含 `manager.py`、`engine/**/*.py`、`webadmin/**/*.py`、`webadmin/requirements.txt`、Python WebAdmin tests、Python CLI fallback 或任何调用 Python runtime 的验证脚本。若需要归档历史 Python 实现，MUST 通过 git tag、branch 或 release artifact 完成，MUST NOT 在仓库内新增包含 `.py` 的归档目录。

#### Scenario: tracked Python files are absent
- **WHEN** M7 完成后检查 `git ls-files`
- **THEN** tracked files 中不存在 `*.py`、`requirements.txt` 或以 Python runtime 为目标的生产/测试入口

#### Scenario: Python archive is outside active tree
- **WHEN** 需要恢复或查看 M7 前 Python 实现
- **THEN** 用户通过 M7 前 git tag、branch 或 release artifact 访问历史内容，而不是通过仓库内 `archive/` 目录访问 `.py` 文件

### Requirement: TS-only command surface
系统 SHALL 将日常执行、沉淀、自愈修复、调度建议、WebAdmin 启动和文档示例统一切换到 `ziniao` 或 TS workspace 命令。README、AGENTS、`docs/`、OpenSpec specs、`.cursor/skills/ziniao-assistant/`、`.codex/skills/` 和 crontab 示例 MUST NOT 指示用户执行 `python3 manager.py`、`python -m engine.self_heal`、`python3 -m webadmin` 或安装 `webadmin/requirements.txt`。

#### Scenario: docs use ziniao commands
- **WHEN** 用户阅读 README、AGENTS、docs 或 ziniao-assistant skill
- **THEN** 常态执行、validate、new、retry、history、heals、stats、cron 和 self-heal 调试示例均使用 `ziniao`/TS 命令

#### Scenario: crontab output uses ziniao
- **WHEN** 用户执行 `ziniao cron`
- **THEN** 输出的调度建议使用 `ziniao run <flow_id>` 或等价构建产物命令，并且不再提示生产 crontab 继续使用 `python3 manager.py run`

### Requirement: M7 preflight gate
系统 SHALL 在删除 Python active tree 前验证前置迁移阶段已经完成。M7 apply MUST 检查并记录：WebAdmin 前端整理已完成、Python/TS CLI 双跑验证已完成、Python/TS WebAdmin 双跑验证已完成、生产入口切换 change 已批准或归档、M7 前恢复点可用。若任一前置证据缺失，M7 implementation MUST stop before deleting Python files。

#### Scenario: preflight evidence present
- **WHEN** M7 implementation 开始执行破坏性删除任务
- **THEN** tasks 记录前置 change、双跑证据、入口切换状态和恢复点

#### Scenario: missing preflight blocks deletion
- **WHEN** 前置双跑或入口切换证据缺失
- **THEN** implementation 停止，不删除 `manager.py`、`engine/` 或 Python WebAdmin 后端

### Requirement: Runtime data contract preserved
系统 SHALL 保留既有 runtime 数据和 flow 资产格式。M7 MUST NOT 迁移或重命名 `flows/*.json`、`extracts/*.js`、`heal_templates/`、`data/logs/runs.jsonl`、`data/output/`、`data/logs/heals/*`、`learnings/heals.jsonl` 或 `learnings/known_issues.json`。TS CLI、flow-engine、self-heal 和 WebAdmin API MUST 继续读写这些路径和 schema-compatible payload。

#### Scenario: existing flow validates after Python removal
- **WHEN** 用户执行 `ziniao validate orders_overview`
- **THEN** TS CLI 通过 `packages/flow-engine` 校验现有 flow 文件，并且不需要 Python runtime

#### Scenario: historical logs remain readable
- **WHEN** 用户通过 `ziniao history` 或 WebAdmin API 查看 M7 前运行日志
- **THEN** 系统读取既有 `data/logs/runs.jsonl`，不要求迁移历史日志格式

### Requirement: Python regression guard
系统 SHALL 在默认安全扫描中阻断 Python runtime 回归。`pnpm security:scan` MUST 检查 tracked source/config/docs 中新增 `.py` 源码、`requirements.txt`、Python subprocess 调用、`python3 manager.py` 示例、`python -m engine.self_heal` 示例、FastAPI/uvicorn WebAdmin 后端依赖，以及任何把失败路径回退到 Python CLI 的逻辑。扫描 MUST 继续阻断本机浏览器自动化和绕过 ZClaw bridge 的路径。

#### Scenario: Python file addition is rejected
- **WHEN** 新增 tracked `*.py` 文件或 `requirements.txt`
- **THEN** `pnpm security:scan` 失败并提示 M7 后仓库禁止 Python runtime 回归

#### Scenario: Python command reference is rejected
- **WHEN** README、docs、skills 或 TS 源码新增 `python3 manager.py` 或 `python -m engine.self_heal` 命令示例
- **THEN** `pnpm security:scan` 失败并提示使用 `ziniao` 或 TS 命令
