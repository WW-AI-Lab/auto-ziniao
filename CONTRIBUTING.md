# Contributing

感谢参与 Auto Ziniao。请先阅读 [AGENTS.md](AGENTS.md) 的安全边界，尤其是禁止本机浏览器自动化的规则。

## 开发流程

1. 从最新主干创建分支。
2. 修改代码、flow、文档时保持边界清晰：ZClaw bridge 访问只能在 `packages/zclaw`。
3. 新增或修改契约时同步 TypeScript 类型、Zod schema 和 JSON Schema。
4. 提交前运行验证：

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm schemas:export -- --check
pnpm security:scan
```

## 文档约定

- 用户文档、注释和提示词默认使用中文。
- 命令、路径、包名、schema 字段保留英文。
- 不提交真实店铺名、运行日志、token、API key 或本机绝对路径。

## 发布

根包是 workspace，不发布。npm 发布包位于 `packages/*`，主入口是 `@ww-ai-lab/auto-ziniao`。
