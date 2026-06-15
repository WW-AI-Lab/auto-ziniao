## 1. WebAdmin Frontend Workspace

- [x] 1.1 创建 `apps/webadmin-frontend` workspace app，迁移 `webadmin/frontend` 的 `src/`、`public/`、`index.html`、Vite/TS/ESLint 配置和 README。
- [x] 1.2 更新 `apps/webadmin-frontend/package.json`，package name 改为 `@ziniao/webadmin-frontend`，保留 React/Vite/antd/`@ant-design/x` 技术栈，移除 npm lockfile 依赖。
- [x] 1.3 更新 root `package.json` scripts，使 `pnpm build`、`pnpm typecheck` 和 `pnpm validate:baseline` 覆盖 `apps/webadmin-frontend`。
- [x] 1.4 更新 `tsconfig.base.json` 和 `vitest.config.ts` alias（如需要），确保 frontend 可导入 `@ziniao/schemas`。

## 2. API Types and Frontend Build

- [x] 2.1 更新前端 API client，复用 `@ziniao/schemas` 中已有 WebAdmin DTO 类型；仅保留 UI-only 类型在前端本地。
- [x] 2.2 若前端需要的共享 DTO 在 `packages/schemas` 中缺失，先扩展 schema/types 和 JSON schema export，再更新前端导入。
- [x] 2.3 运行 `pnpm --filter @ziniao/webadmin-frontend build`，修复迁移导致的 TS/Vite 错误。
- [x] 2.4 运行前端依赖与源码安全检查，确认无 direct bridge、ZClaw API key、本机浏览器或浏览器自动化依赖。

## 3. WebAdmin API Static Serving

- [x] 3.1 修改 `apps/webadmin-api` 默认 `frontendDist` 为 `apps/webadmin-frontend/dist`，保留测试/显式配置注入能力。
- [x] 3.2 更新 WebAdmin API missing/present dist 测试，覆盖 `apps/webadmin-frontend/dist` 默认路径和注入路径。
- [x] 3.3 运行 `pnpm --filter @ziniao/webadmin-api test`，确认 REST/SSE API、scheduler、chat 和 static fallback 仍通过。
- [x] 3.4 执行精确边界检查：`rg -n "9481|/zclaw/tools|ZCLAW_API_KEY|\\.zclaw" apps/webadmin-api/src apps/webadmin-frontend/src` 只能无命中或命中明确允许的测试断言。

## 4. Cutover Evidence

- [x] 4.1 运行 `pnpm ziniao validate orders_overview`，记录 TS CLI validate 结果。
- [x] 4.2 运行 local-only `pnpm ziniao run webadmin_selftest -p greeting=frontend-cutover --no-heal`，记录状态、run log/output 摘要；不得调用真实 bridge。
- [x] 4.3 记录 WebAdmin API smoke 证据：至少包含 `/api/flows`、`/api/stats`、chat SSE mock、static present/missing dist 测试结果。
- [x] 4.4 说明真实 bridge flow 双跑是否执行；若未执行，记录原因（未确认紫鸟客户端在线、测试店铺参数或低风险真实 flow），不得改用本机浏览器。
- [x] 4.5 将上述证据写入 `docs/06-TS迁移进度与路线图.md` 的本阶段小节，供 `remove-python-runtime` preflight 引用。

## 5. Documentation and Route Map

- [x] 5.1 更新 `README.md`，说明 WebAdmin 前端目标目录为 `apps/webadmin-frontend`，开发/构建/托管命令使用 pnpm workspace。
- [x] 5.2 更新 `AGENTS.md`，将“下一阶段”从前端整理调整为双跑/入口切换准备完成状态，并明确本阶段仍不删除 Python。
- [x] 5.3 更新 `docs/06-TS迁移进度与路线图.md`，记录本 change 的完成边界、验收命令、M7 preflight 证据路径和剩余工作。
- [x] 5.4 更新 `remove-python-runtime/tasks.md` 的前置 gate 说明，引用本 change 的证据位置，但不勾选 M7 任务，留给 M7 apply 复核。

## 6. Validation

- [x] 6.1 运行 `pnpm typecheck`。
- [x] 6.2 运行 `pnpm test`。
- [x] 6.3 运行 `pnpm build`。
- [x] 6.4 运行 `pnpm schemas:export -- --check`。
- [x] 6.5 运行 `pnpm security:scan`。
- [x] 6.6 运行 `pnpm validate:baseline`，确认默认验证不调用真实 bridge、真实 flow、真实 Agent CLI 或本机浏览器。
- [x] 6.7 运行 `openspec validate prepare-webadmin-frontend-cutover --strict`。
- [x] 6.8 检查 `git status --short`，确认实现范围只包含本 change 相关迁移、文档、spec 和验证改动。

## 7. Finalization

- [x] 7.1 在 `tasks.md` 记录最终验证结果和任何未执行的真实 bridge 验证原因。
- [x] 7.2 确认 `remove-python-runtime` 的 blocker 已有可复核证据后，返回继续 M7 preflight。

## Final Validation Notes

- `pnpm --filter @ziniao/webadmin-frontend build`: success，生成 `apps/webadmin-frontend/dist/index.html` 和 Vite assets。
- `pnpm --filter @ziniao/webadmin-api test`: success，2 个 test files、10 个 tests，覆盖 `/api/flows`、`/api/stats`、chat SSE mock、static missing/present dist 和显式 `frontendDist` 注入。
- `rg -n "9481|/zclaw/tools|ZCLAW_API_KEY|\\.zclaw" apps/webadmin-api/src apps/webadmin-frontend/src`: 无命中。
- `pnpm ziniao validate orders_overview`: success，输出 `orders_overview 校验通过`。
- `pnpm ziniao run webadmin_selftest -p greeting=frontend-cutover --no-heal`: success，`data/logs/runs.jsonl` 记录 `2026-06-15 10:55:46`，输出 `selftest: frontend-cutover` / `selftest done`。
- `pnpm typecheck`: success。
- `pnpm test`: success，10 个 test files、92 个 tests。
- `pnpm build`: success，包含 `@ziniao/webadmin-frontend` Vite build。
- `pnpm schemas:export -- --check`: success，JSON Schema 已是最新。
- `pnpm security:scan`: success，`== Security scan ok ==`。
- `pnpm validate:baseline`: success；默认验证未调用真实 bridge、真实店铺 flow、真实 Agent CLI 或本机浏览器。
- `openspec validate prepare-webadmin-frontend-cutover --strict`: success。
- 真实 bridge flow 双跑未执行：未收到用户明确确认紫鸟客户端在线、测试店铺参数和低风险真实 flow；按最高安全规则不改用本机浏览器或浏览器自动化。
- `git status --short` 已检查：存在先前无关的 `.cursor/skills`、`.codex/` 和若干 docs/OpenSpec untracked 项；本 change 相关实现集中在 `apps/webadmin-frontend`、`apps/webadmin-api`、`packages/schemas`、workspace 配置、README、AGENTS、`docs/06-TS迁移进度与路线图.md` 和相关 OpenSpec tasks。
- `remove-python-runtime` blocker 证据位置：`docs/06-TS迁移进度与路线图.md` 的“WebAdmin 前端整理与双跑切换准备”小节，以及本文件第 4/6/7 组验证记录；M7 tasks 1.2/1.3 已引用这些证据但未勾选，留给 M7 apply 复核。
