# 安全模型

Auto Ziniao 的核心安全目标是：店铺操作必须发生在紫鸟店铺浏览器和独立网络环境中，而不是本机浏览器。

## 强制边界

- `packages/zclaw` 是唯一允许访问 `127.0.0.1:9481` 的包。
- 只允许访问 `/zclaw/*` 路径。
- `packages/cli`、`apps/api`、`apps/web` 不得读取 ZClaw API key。
- `apps/web` 只能通过 same-origin `/api/*` 访问 WebAdmin API。
- 默认测试和 baseline 必须使用 mock client、临时 data root 和 no-op sleeper。

## 失败策略

如果 bridge 连接拒绝或超时，视为紫鸟客户端未启动或本机环境问题。系统应停止并提示用户处理环境，不得切换到本机浏览器方案。

## 安全扫描

```bash
pnpm security:scan
```

扫描会阻断本机浏览器自动化依赖、直接 bridge 访问、API key 读取越界和可疑 URL 打开命令。
