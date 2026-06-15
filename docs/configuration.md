# 配置说明

## ZClaw API key

推荐放在用户级配置：

```json
{
  "ZCLAW_API_KEY": "<your-zclaw-api-key>"
}
```

路径为 `~/.zclaw/config.json`。也可以使用环境变量 `ZCLAW_API_KEY`。不要把真实 key 写入仓库。

## 项目配置

复制示例文件：

```bash
cp config.example.json config.json
```

`config.json` 用于 WebAdmin chat 和 self-heal Agent CLI。它是本机配置，已被 `.gitignore` 排除。

常见字段：

| 字段 | 说明 |
| --- | --- |
| `webadmin.chat.agent` | WebAdmin 默认对话 agent |
| `webadmin.chat.agents.*` | WebAdmin 可选 agent 配置 |
| `heal.enabled` | 是否允许失败时触发自愈 |
| `heal.cooldown_minutes` | 同一问题自愈冷却时间 |
| `heal.max_per_day` | 每日自愈上限 |
| `heal.agents.*.command` | Agent CLI 命令模板 |

命令模板支持 `{prompt}`、`{prompt_path}`、`{session_key}`、`{flow_id}`、`{heal_id}`。
