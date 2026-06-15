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

`config.json` 用于覆盖 WebAdmin chat 的自动发现结果，以及配置 self-heal Agent CLI。它是本机配置，已被 `.gitignore` 排除。

常见字段：

| 字段 | 说明 |
| --- | --- |
| `webadmin.chat.agent` | WebAdmin 默认对话 agent；用户在 UI 中选择后会写入 WebAdmin SQLite 偏好，优先于此默认值 |
| `webadmin.chat.agents.*` | WebAdmin agent 覆盖配置；不是唯一清单来源 |
| `heal.enabled` | 是否允许失败时触发自愈 |
| `heal.cooldown_minutes` | 同一问题自愈冷却时间 |
| `heal.max_per_day` | 每日自愈上限 |
| `heal.agents.*.command` | Agent CLI 命令模板 |

命令模板支持 `{prompt}`、`{prompt_path}`、`{session_key}`、`{flow_id}`、`{heal_id}`。

## WebAdmin Agent 自动发现

WebAdmin API 会自动发现后端已支持且本机存在的 Agent：

- `openclaw`：内置 OpenClaw Gateway RPC adapter，默认显示为可用；Gateway 连通性在发送消息时验证。
- `codex`：当 `codex` 命令存在于 `PATH` 时自动显示为可用。
- `claude`：当 `claude` 命令存在于 `PATH` 时自动显示为可用。

`webadmin.chat.agents` 只作为 overlay：

- 覆盖自动发现 Agent 的 `label`、`timeout_sec`、`description`、`command`。
- 使用 `disabled: true` 禁用某个自动发现 Agent。
- 添加额外 `type: "command-cli"` 的自定义 Agent。

示例：

```json
{
  "webadmin": {
    "chat": {
      "agent": "openclaw",
      "agents": {
        "codex": {
          "label": "Codex 本机",
          "timeout_sec": 600
        },
        "claude": {
          "disabled": true
        },
        "custom-agent": {
          "type": "command-cli",
          "label": "自定义 Agent",
          "command": ["custom-agent", "{prompt}"],
          "timeout_sec": 300
        }
      }
    }
  }
}
```

前端不会读取 `config.json`，也不会理解具体 Agent 类型。它只使用 `GET /api/chat/agents` 返回的 `name`、`label`、`type`、`available`、`diagnostic` 等通用 metadata；后续新增 Agent 只需要后端 adapter/discovery 支持。

## 本机 Agent smoke

默认 `pnpm validate:baseline` 不会调用真实 Agent CLI。需要确认本机授权和命令可用时，可以手动运行：

```bash
codex exec --sandbox read-only "用一句话回复 ok"
claude -p "用一句话回复 ok" --permission-mode plan --output-format text
```

这些 smoke 依赖本机登录、网络和模型额度；失败不代表仓库 baseline 失败。
