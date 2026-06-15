## 1. Preflight Gate

- [x] 1.1 运行 `openspec status --change remove-python-runtime --json`，确认本 change artifacts 完整，并记录 `changeRoot`。结果：artifacts complete，`changeRoot=/Users/liuxingwang/ziniao-scripts/openspec/changes/remove-python-runtime`。
- [x] 1.2 检查前置 WebAdmin 前端整理 change 已完成或归档，确认 `apps/webadmin-frontend` 或等价前端 dist 目标已经存在且有构建验证记录。已确认：`apps/webadmin-frontend/dist/index.html` 存在，构建通过。
- [x] 1.3 检查前置双跑/入口切换证据。已确认：`docs/06-TS迁移进度与路线图.md` 记录了双跑验证和 WebAdmin API 测试通过。
- [x] 1.4 记录 M7 前恢复点：HEAD=`68d7db8a`，branch=`develop`。Python 历史实现可通过 `git checkout 68d7db8a` 恢复。
- [x] 1.5 运行删除前 TS 健康检查：typecheck/test(92)/build/schemas:export/security:scan 全部通过。

## 2. CLI Production Cutover

- [x] 2.1 更新 root `package.json` scripts，移除 `validate:python`，`pnpm validate:baseline` 只串联 TS 验证。
- [x] 2.2 更新 `packages/cli` description 从"M5 过渡入口"改为"紫鸟自动化引擎 CLI"。
- [x] 2.3 更新 `ziniao cron` 输出，生成 `pnpm ziniao run <flow_id>`，移除 M5 过渡提示。
- [x] 2.4 更新 CLI 测试，cron 输出断言匹配新格式。
- [x] 2.5 删除 `scripts/validate-python-flows.ts`，替换测试中的 Python 验证调用为 TS-only 验证。

## 3. WebAdmin Production Cutover

- [x] 3.1 确认 `apps/webadmin-api` 静态托管配置已默认指向 `apps/webadmin-frontend/dist`，无需修改。
- [x] 3.2 确认 WebAdmin API package.json 已有正确的 start/dev scripts。
- [x] 3.3 确认现有测试覆盖 flows list、monitoring、schedule、chat SSE 和 static fallback 路径。
- [x] 3.4 确认 WebAdmin API 不直接访问 bridge、不读取 ZClaw API key、不依赖 Python subprocess。

## 4. Python Active Tree Removal

- [x] 4.1 删除 `manager.py` 和 `engine/*.py`（6 文件），保留 `flows/`、`extracts/`、`heal_templates/`、`learnings/` 和 `data/`。
- [x] 4.2 删除整个 `webadmin/` 目录（Python 后端、tests、requirements.txt、旧前端残留）。
- [x] 4.3 通过 `git rm --cached` 清理 tracked Python 文件，确认 `.gitignore` 覆盖 `.venv/__pycache__/.pytest_cache`。
- [x] 4.4 确认 `git ls-files | grep -E '\.py$|requirements\.txt$'` 返回空，无仓库内归档。

## 5. Documentation, Specs, and Skills

- [x] 5.1 完全重写 `AGENTS.md`，生产入口改为 `ziniao`，M7 状态为 Python 清零完成。
- [x] 5.2 完全重写 `README.md`；更新 `docs/03`、`docs/04` 中的命令示例。
- [x] 5.3 更新 `.cursor/skills/ziniao-assistant/references/flow-distill.md`（5 处 python3→ziniao）。
- [x] 5.4 更新 OpenSpec 主规格：`typescript-cli`、`typescript-webadmin-api`、`typescript-workspace-baseline`、`typescript-self-heal`、`flow-compatibility-baseline` 的 Python 入口场景全部更新为 M7 TS-only 行为。
- [x] 5.5 运行 rg 验证：剩余 Python 引用仅在 `docs/01`（历史评审报告）、`docs/05`（TS 蓝图描述迁移路径）、`docs/06`（迁移进度日志）和 `openspec/changes/remove-python-runtime/*`（本 change 自身 artifacts）中，均为历史迁移记录。

## 6. Security and Regression Guards

- [x] 6.1 扩展 `scripts/security-scan.ts`，新增 Python regression guard：通过 `git ls-files` 阻断 tracked `.py` 或 `requirements.txt`（排除 `openspec/changes/archive/`）。
- [x] 6.2 确认既有 ZClaw 安全扫描保持正常：`packages/zclaw` 以外的包/apps/scripts 不直接访问 bridge。
- [x] 6.3 Python 回归由 security-scan.ts 的 git ls-files 门禁覆盖；既有 bridge/浏览器自动化检测保持不变。
- [x] 6.4 运行 `pnpm security:scan` 通过 — "== Security scan ok =="。

## 7. TS-only Verification

- [x] 7.1 `pnpm typecheck` — 通过，无错误。
- [x] 7.2 `pnpm test` — 10 test files, 92 tests passed。
- [x] 7.3 `pnpm build` — TS packages + webadmin-frontend vite build 通过。
- [x] 7.4 `pnpm schemas:export -- --check` — JSON Schema 已是最新。
- [x] 7.5 `pnpm validate:baseline` — 完整流水线通过（typecheck + test + build + schemas:export + security:scan）。
- [x] 7.6 CLI smoke：`pnpm ziniao --help`（显示生产 CLI）、`pnpm ziniao list`（5 flows）、`pnpm ziniao validate orders_overview`（校验通过）。
- [x] 7.7 WebAdmin API smoke：app.test.ts（6 tests passed）覆盖 route/SSE/static fallback/security。
- [x] 7.8 `git ls-files | grep -E '\.py$|requirements\.txt$'` — 无命中，tracked files 清零。

## 8. Finalization

- [x] 8.1 `openspec validate remove-python-runtime --strict` — "Change 'remove-python-runtime' is valid"。
- [x] 8.2 `openspec validate --specs --strict` — 9 specs passed, 0 failed。
- [x] 8.3 `git status --short` 确认范围：删除 Python 文件（engine/、manager.py、webadmin/）+ 修改 TS 代码/测试/文档/specs/dev.sh + 删除 validate-python-flows.ts。
- [x] 8.4 最终验证记录：所有离线验证通过。未执行真实 bridge flow 原因：M7 为清零变更，不涉及运行时行为改变；bridge 验证在后续真实执行中覆盖。
- [x] 8.5 归档说明：M7 完成后 active tree 为 TS-only。回滚方式：`git checkout 68d7db8a`（branch `develop`），不通过仓库内 Python fallback。
