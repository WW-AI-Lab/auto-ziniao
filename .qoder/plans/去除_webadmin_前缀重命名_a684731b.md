# 去除 webadmin- 前缀重命名规划

## 改名方案

| 原名 | 新名 |
|------|------|
| `apps/webadmin-api/` | `apps/api/` |
| `apps/webadmin-frontend/` | `apps/web/` |
| `@ziniao/webadmin-api` | `@ziniao/api` |
| `@ziniao/webadmin-frontend` | `@ziniao/web` |
| 脚本 `webadmin:api` | `api` |
| 脚本 `webadmin:frontend` | `web` |
| 脚本 `webadmin:frontend:build` | `web:build` |

## 影响分析（共 ~15 个活跃文件）

### Task 1: 目录重命名

用 `git mv` 重命名两个目录：
- `apps/webadmin-api/` → `apps/api/`
- `apps/webadmin-frontend/` → `apps/web/`

### Task 2: 包名和内部脚本更新（3 个 package.json）

**`apps/api/package.json`**（原 webadmin-api）:
- `name`: `@ziniao/webadmin-api` → `@ziniao/api`
- `scripts.test`: 路径 `apps/webadmin-api/src/...` → `apps/api/src/...`

**`apps/web/package.json`**（原 webadmin-frontend）:
- `name`: `@ziniao/webadmin-frontend` → `@ziniao/web`

**根 `package.json`**:
- `scripts.build`: `apps/webadmin-api` → `apps/api`，`@ziniao/webadmin-frontend` → `@ziniao/web`
- `scripts.typecheck`: 同上两个路径
- `scripts.webadmin:api` → `scripts.api`，路径更新
- `scripts.webadmin:frontend` → `scripts.web`，包名更新
- `scripts.webadmin:frontend:build` → `scripts.web:build`，包名更新

### Task 3: TypeScript 配置（2 个文件）

**`tsconfig.base.json`**:
- paths `@ziniao/webadmin-api` → `@ziniao/api`，路径 `apps/webadmin-api/...` → `apps/api/...`
- paths `@ziniao/webadmin-frontend` → `@ziniao/web`，路径 `apps/webadmin-frontend/...` → `apps/web/...`

**`vitest.config.ts`**:
- alias 同步更新（同上）

### Task 4: 源码中的硬编码路径（3 个文件）

**`apps/api/src/config.ts`** (第 44 行):
- `path.join(repoRoot, "apps", "webadmin-frontend", "dist")` → `path.join(repoRoot, "apps", "web", "dist")`

**`apps/api/src/app.ts`** (第 476、483 行):
- 错误消息中 `apps/webadmin-frontend/dist` → `apps/web/dist`

**`apps/api/src/app.test.ts`** (第 13、141、160 行):
- describe 名称和路径断言中的 `webadmin-api` / `webadmin-frontend` → `api` / `web`

**`apps/api/src/triggers.test.ts`** (第 5 行):
- describe 名称 `webadmin-api triggers` → `api triggers`

### Task 5: 安全扫描脚本

**`scripts/security-scan.ts`**:
- `isWebAdminApiApp` 函数 (第 52 行): 路径前缀 `apps/webadmin-api/` → `apps/api/`
- 包名校验 (第 104-105 行): `apps/webadmin-api/package.json` → `apps/api/package.json`
- import 校验 (第 124-125 行): 错误消息更新

### Task 6: 开发启动脚本

**`dev.sh`**:
- 注释 (第 3 行): `webadmin-api` / `webadmin-frontend` → `api` / `web`
- `--filter @ziniao/webadmin-api` → `--filter @ziniao/api` (第 42 行)
- `--filter @ziniao/webadmin-frontend` → `--filter @ziniao/web` (第 46 行)

### Task 7: 项目文档更新（2 个活跃文档）

**`AGENTS.md`** — 约 10 处引用需更新（路径、包名、命令）

**`README.md`** — 约 3 处引用需更新

> 注：`docs/` 和 `openspec/changes/archive/` 下的文件为历史归档记录，建议不修改以保持历史一致性。如需更新请另行决定。

### Task 8: 重新安装依赖并验证

1. `pnpm install` — 刷新 workspace 链接
2. `pnpm typecheck` — 类型检查通过
3. `pnpm test` — 所有测试通过
4. `pnpm security:scan` — 安全扫描通过
5. `pnpm build` — 构建成功

## 注意事项

- `pnpm-workspace.yaml` 使用 `apps/*` 通配符，无需修改
- `.gitignore` 使用 `apps/*/dist/` 通配符，无需修改
- 前端 `tsconfig.app.json` / `tsconfig.node.json` 内部无 webadmin 路径引用，无需修改
- `packages/` 下无对 `webadmin-api` / `webadmin-frontend` 的 import 引用
- `openspec/changes/archive/` 和 `docs/` 中的历史文档建议保持原样
