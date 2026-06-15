## Why

WebAdmin 的 Agent 对话已经具备会话、消息、SSE 和 OpenClaw Gateway RPC 通道，但当前 Agent 列表主要来自 repo config，前端也把“可选 Agent”理解成当前配置项。后续要接入 codex、Claude Code、OpenClaw 以及其他主流 Agent 时，如果每次都修改前端，就会把 Agent 生态差异泄漏到 UI 层，增加维护成本。

本变更要把 Agent 发现、适配和安全诊断收敛到 WebAdmin API 后端：后端自动探测本机已安装且已有 adapter 支持的 Agent，并结合 repo config 做覆盖/禁用/自定义；前端只消费统一 metadata 和 same-origin API。用户在 chat 中选择 Agent 后，下次默认记住该选择。

## What Changes

- 新增统一 Agent adapter/metadata 契约，首批支持 OpenClaw、codex、Claude Code，并为后续 Agent 类型保留后端扩展点。
- 后端 API 自动发现本机 supported Agents：如果 adapter 支持且本机命令/运行条件存在，则自动出现在 `/api/chat/agents`，无需先写入 `config.json`。
- repo config 从“唯一 Agent 清单来源”调整为“覆盖与策略来源”：可设置 label、timeout、command、disabled、优先级和安全参数。
- 新增 codex、Claude Code CLI chat adapter；OpenClaw 继续复用既有 Gateway RPC adapter，不切换到外部投递或本机浏览器方案。
- 前端 chat Agent 选择器改为统一 metadata-driven：新增 Agent 类型时，只要后端返回标准 metadata，前端无需改代码。
- 保存用户最后选择的 Agent 作为 WebAdmin 自有偏好；新建会话默认使用该偏好，偏好不可用时回退到后端默认。
- 默认验证保持离线：单测使用 mock adapter/mock command，不调用真实 codex、Claude Code、OpenClaw Gateway、ZClaw bridge 或本机浏览器；真实 CLI smoke 作为显式本机验收。

## Capabilities

### New Capabilities

- `agent-adapter-selection`: 定义 Agent 自动发现、统一 metadata、adapter 调度、CLI adapter 安全执行、用户默认偏好和前端无感扩展边界。

### Modified Capabilities

- `typescript-webadmin-api`: 扩展 WebAdmin chat API 的 Agent 自动发现、adapter registry、metadata 响应、偏好读写和 CLI 错误诊断行为。
- `typescript-webadmin-frontend`: 扩展 chat UI 的通用 Agent selector、metadata-driven 展示、选择记忆和无新增 Agent 前端改造要求。
- `typescript-self-heal`: 对齐 command 型 Agent 配置语义，保持 self-heal runner 独立、mock/offline 测试和安全诊断要求。

## Architecture Impact

- 现有能力复用：`typescript-webadmin-api` 已有 chat session/message/SSE、SQLite 存储和 OpenClaw Gateway RPC；`typescript-webadmin-frontend` 已有 chat 页面和 shared DTO；`typescript-self-heal` 已有 command adapter/runner 诊断语义。
- 新增后端边界：Agent discovery、adapter registry、CLI 执行、metadata 安全过滤和 default preference 都属于 `apps/api`；`apps/web` 不执行命令、不读取 config、不识别具体 CLI 参数。
- 配置边界：`config.example.json` 和真实 `config.json` 只覆盖自动发现结果或声明额外 command adapter；不得把 token、完整 command、完整 prompt 或本机敏感路径返回给前端。
- 测试边界：baseline 继续离线；真实 `codex exec` 和 `claude -p` 仅作为可选本机 smoke，并在 tasks 中明确。

## Impact

- `packages/schemas`：扩展 `ChatAgentInfo`、adapter diagnostic、preference DTO 和 SSE/message extras。
- `apps/api`：新增 discovery、adapter registry、command adapter、codex/Claude Code adapter、preference API/storage 和测试。
- `apps/web`：更新 chat selector 为后端 metadata-driven，不再为新增 Agent 类型写条件分支。
- `packages/self-heal`：兼容共享 command config 语义，但不依赖 WebAdmin API。
- `config.example.json`、docs、`scripts/security-scan.ts` 和验证链：补充自动发现、覆盖配置、安全扫描例外与本机 smoke 说明。
