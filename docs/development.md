# 开发者指南

## 环境

- Node.js >= 22
- pnpm 10.x
- 不需要启动紫鸟客户端即可运行默认测试和基线验证

```bash
corepack enable
corepack pnpm install
corepack pnpm validate:baseline
```

## Workspace

| 路径 | 职责 |
| --- | --- |
| `packages/core` | 文件、JSON、错误类型等无浏览器副作用基础能力 |
| `packages/schemas` | Zod 契约、类型和 JSON Schema |
| `packages/zclaw` | 唯一 ZClaw bridge HTTP 出口 |
| `packages/flow-engine` | flow 加载、校验、执行、pacing、risk、confirm |
| `packages/self-heal` | 已知问题、自愈上下文、提示词和 Agent runner |
| `packages/cli` | `auto-ziniao` CLI |
| `apps/api` | 本机 WebAdmin API |
| `apps/web` | WebAdmin React 前端 |

## 验证命令

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm schemas:export -- --check
pnpm security:scan
pnpm validate:baseline
```

默认验证不得调用真实 ZClaw bridge、不得打开本机浏览器、不得调用真实 Agent CLI。

## npm 打包

只发布一个 npm 包：`@ww-ai-lab/auto-ziniao`。内部 `packages/*` 目录只作为源码模块和安全边界，不再单独发布。

发布前执行：

```bash
pnpm validate:baseline
npm pack --dry-run
```
