# Auto Ziniao WebAdmin

本目录是 Auto Ziniao 的本机 WebAdmin 前端，使用 React、Vite、TypeScript、antd 和 `@ant-design/x`。

```bash
pnpm --filter @ww-ai-lab/auto-ziniao-web dev
pnpm --filter @ww-ai-lab/auto-ziniao-web build
```

前端只能通过 same-origin `/api/*` 访问 `apps/api`，不得直接访问 ZClaw bridge、读取 ZClaw API key 或引入本机浏览器自动化依赖。
