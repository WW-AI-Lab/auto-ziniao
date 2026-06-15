## 1. Preflight Gate

- [x] 1.1 运行 `openspec status --change remove-python-runtime --json`，确认本 change artifacts 完整，并记录 `changeRoot`。结果：artifacts complete，`changeRoot=/Users/liuxingwang/ziniao-scripts/openspec/changes/remove-python-runtime`。
- [ ] 1.2 检查前置 WebAdmin 前端整理 change 已完成或归档，确认 `apps/webadmin-frontend` 或等价前端 dist 目标已经存在且有构建验证记录。前置证据待 M7 apply 复核：`prepare-webadmin-frontend-cutover` 已创建 `apps/webadmin-frontend` 并记录 `pnpm --filter @ziniao/webadmin-frontend build` success，证据位置见 `docs/06-TS迁移进度与路线图.md` 的“WebAdmin 前端整理与双跑切换准备”小节。
- [ ] 1.3 检查前置双跑/入口切换证据：TS CLI validate/run 双跑、WebAdmin API 双跑、生产入口切换批准或归档记录均可定位；若缺失，停止实现并更新 artifacts，不删除 Python 文件。前置证据待 M7 apply 复核：`prepare-webadmin-frontend-cutover` 已记录 WebAdmin API test/smoke、`pnpm ziniao validate orders_overview`、local-only `pnpm ziniao run webadmin_selftest -p greeting=frontend-cutover --no-heal`；真实 bridge flow 未执行原因已记录在 `docs/06-TS迁移进度与路线图.md`，生产入口切换批准仍留给 M7 preflight 判断。
- [ ] 1.4 记录 M7 前恢复点：`git rev-parse HEAD`、当前 branch、必要 tag/branch 或 release artifact 位置，确保 Python 历史实现可通过 git 恢复。
- [ ] 1.5 运行删除前 TS 健康检查：`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm schemas:export -- --check`、`pnpm security:scan`；若失败，先修复 TS 路径，不进入删除阶段。

## 2. CLI Production Cutover

- [ ] 2.1 更新 root `package.json` scripts，移除 `validate:python` 和对 Python CLI 的 baseline 依赖，让 `pnpm validate:baseline` 只串联 TS 验证。
- [ ] 2.2 更新 `packages/cli` help/description/输出文案，将 `ziniao` 从“过渡入口”改为生产入口。
- [ ] 2.3 更新 `ziniao cron` 输出，生成 `ziniao run <flow_id>` 或构建产物命令，不再提示生产 crontab 继续使用 `python3 manager.py run`。
- [ ] 2.4 更新 CLI 测试，覆盖 `ziniao --help`、`ziniao cron`、`ziniao validate orders_overview` 不依赖 Python runtime、不包含 Python fallback 文案。
- [ ] 2.5 删除或替换 `scripts/validate-python-flows.ts`，将当前 flow 全量校验改为 TS flow-engine/schema 动态校验。

## 3. WebAdmin Production Cutover

- [ ] 3.1 更新 `apps/webadmin-api` 静态托管配置，读取前置阶段确定的 WebAdmin frontend dist 路径，并保留 missing dist 的结构化状态响应。
- [ ] 3.2 更新 WebAdmin API 启动脚本和 README 示例，生产 WebAdmin 仅通过 TS workspace script 或构建产物启动。
- [ ] 3.3 增加或更新 WebAdmin API smoke/injection 测试，覆盖 flows list、manual validate、monitoring、schedule、chat SSE 和 static fallback 的 TS-only 路径。
- [ ] 3.4 确认 WebAdmin API 不直接访问 bridge、不读取 ZClaw API key、不依赖 Python subprocess；用 `rg` 和安全扫描验证。

## 4. Python Active Tree Removal

- [ ] 4.1 删除 `manager.py` 和 `engine/` Python engine 文件，保留 `flows/`、`extracts/`、`heal_templates/`、`learnings/` 和 `data/` 契约。
- [ ] 4.2 删除 Python FastAPI WebAdmin 后端源码、tests、`webadmin/requirements.txt` 和 Python WebAdmin 启动说明；若前端已迁移，删除旧 `webadmin/frontend/` 残留。
- [ ] 4.3 删除 Python cache/test 配置和 repo 内可跟踪的 Python 依赖痕迹；不处理未跟踪本地 `.venv`，但确保它不进入 tracked files。
- [ ] 4.4 确认没有把 Python 文件移动到仓库内归档目录；历史归档只依赖 1.4 记录的 git 恢复点。

## 5. Documentation, Specs, and Skills

- [ ] 5.1 更新 `AGENTS.md`：当前生产入口改为 `ziniao`，M7 状态改为 Python 清零完成，删除“当前禁止替换 Python 入口”等过渡期描述。
- [ ] 5.2 更新 `README.md` 和 `docs/` 中所有日常命令、沉淀流程、自愈修复、WebAdmin 启动、crontab、回滚和 TS 路线图说明。
- [ ] 5.3 更新 `.cursor/skills/ziniao-assistant/` 和 `.codex/skills/` 中的 setup、flow-distill、自愈修复指令，全部切换到 `ziniao` 命令。
- [ ] 5.4 更新 OpenSpec 主规格或相关 archived evidence 引用，确保 `typescript-cli`、`typescript-webadmin-api`、`typescript-workspace-baseline`、`flow-compatibility-baseline` 与 M7 TS-only 行为一致。
- [ ] 5.5 运行 `rg -n "python3 manager\\.py|python -m engine|python3 -m webadmin|FastAPI|uvicorn|webadmin/requirements\\.txt|validate:python"`，确认仅剩历史 archive 或明确说明的迁移记录；active docs/skills/source 不再指导 Python 用法。

## 6. Security and Regression Guards

- [ ] 6.1 扩展 `scripts/security-scan.ts`，基于 tracked files 或受控目录阻断 `.py`、`requirements.txt`、Python subprocess、旧 Python 命令示例和 FastAPI/uvicorn WebAdmin 依赖回归。
- [ ] 6.2 保持既有 ZClaw 安全扫描：除 `packages/zclaw` 外，`packages/*`、`apps/*`、`scripts/*` 不得直接访问 `9481`、`/zclaw/tools`、`ZCLAW_API_KEY` 或本机浏览器。
- [ ] 6.3 为 security scan 新增回归 fixture 或测试断言，覆盖 Python 文件、Python 命令文档、direct bridge 和浏览器自动化依赖。
- [ ] 6.4 运行 `pnpm security:scan`，确认 M7 后安全边界和 Python 清零门禁通过。

## 7. TS-only Verification

- [ ] 7.1 运行 `pnpm typecheck`。
- [ ] 7.2 运行 `pnpm test`。
- [ ] 7.3 运行 `pnpm build`。
- [ ] 7.4 运行 `pnpm schemas:export -- --check`。
- [ ] 7.5 运行 `pnpm validate:baseline`，确认不调用 Python runtime、真实 ZClaw bridge 或真实 Agent CLI。
- [ ] 7.6 运行 `pnpm ziniao --help`、`pnpm ziniao list`、`pnpm ziniao validate orders_overview` 和一个 local-only flow smoke，确认生产 CLI 可用。
- [ ] 7.7 启动或 injection smoke `apps/webadmin-api`，确认 local-only binding、核心 API、chat SSE 和静态托管状态可用。
- [ ] 7.8 执行 tracked file 清零检查：`git ls-files | rg '\\.py$|requirements\\.txt$'` 应无命中；若有命中，必须解释并修正。

## 8. Finalization

- [ ] 8.1 运行 `openspec validate remove-python-runtime --strict`。
- [ ] 8.2 运行 `openspec validate --specs --strict`，确认归档后主规格仍可通过。
- [ ] 8.3 检查 `git status --short`，确认本 change 的实现范围只包含 M7 相关代码、文档、spec 和验证改动。
- [ ] 8.4 在 `tasks.md` 中记录最终验证命令结果和任何未执行的真实 bridge 验证原因。
- [ ] 8.5 准备归档说明：M7 完成后 active tree 为 TS-only，回滚通过 1.4 的 git 恢复点，不通过仓库内 Python fallback。
