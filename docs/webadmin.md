# WebAdmin 手册

WebAdmin 是本机管理界面，用于查看、编辑、运行 flow，管理计划任务，查看运行和自愈记录。

## 启动

```bash
cp config.example.json config.json
pnpm web:build
pnpm api
```

默认地址：`http://127.0.0.1:9482`

## 边界

- 只监听 `127.0.0.1`。
- 前端通过 same-origin `/api/*` 调用后端。
- 后端不直接访问 ZClaw bridge；真实 flow 执行仍通过 flow-engine 注入的 tool client 和 ZClaw adapter。
- WebAdmin 状态存储在 `data/webadmin.db`，运行态数据不提交。

## 开发

```bash
pnpm api
pnpm web
```

Vite 开发服务器会把 `/api` 代理到 `http://127.0.0.1:9482`。
