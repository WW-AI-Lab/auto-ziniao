## MODIFIED Requirements

### Requirement: Flow file management commands
系统 SHALL 提供 flow 管理命令。`ziniao new <flow_id> [name]` MUST preserve its command-line interface and user-facing success/failure semantics, but MUST create the flow by calling the local WebAdmin API `POST /api/flows` instead of directly reading `flows/_template.json` or writing `flows/<flow_id>.json`. If the WebAdmin API is unavailable, `ziniao new` MUST return non-zero with an actionable message and MUST NOT fall back to direct file writes. `ziniao enable <flow_id>` 与 `ziniao disable <flow_id>` MUST 只修改目标 flow 的 `enabled` 字段并保持 JSON 格式可读。

#### Scenario: new creates scaffold through API
- **WHEN** 用户执行 `ziniao new sample_flow 样例流程` 且 WebAdmin API 接受创建请求
- **THEN** CLI 调用 `POST /api/flows` 创建 flow，输出创建成功提示和后续 validate/run 指引，并返回 exit code 0

#### Scenario: new refuses overwrite through API error
- **WHEN** WebAdmin API 返回 flow 已存在的 conflict 响应
- **THEN** `ziniao new` 返回非 0，展示 API 返回的错误信息，且 CLI 不直接覆盖现有文件

#### Scenario: new has no local fallback
- **WHEN** WebAdmin API 不可达或返回非 JSON 错误
- **THEN** `ziniao new` 返回非 0 并提示启动 WebAdmin API，不读取 `flows/_template.json`，不直接写入 `flows/<flow_id>.json`

#### Scenario: enable and disable update only target flow
- **WHEN** 用户执行 `ziniao disable orders_overview` 后再执行 `ziniao enable orders_overview`
- **THEN** CLI 只更新该 flow 的 `enabled` 字段，并保持其他 flow 文件不变

## ADDED Requirements

### Requirement: CLI authoring API tests
CLI SHALL test `ziniao new` through a mock or injectable HTTP endpoint. Tests MUST NOT require WebAdmin API to be running, MUST NOT write real repository flow files unless using a temporary root for unrelated command tests, and MUST NOT call ZClaw bridge.

#### Scenario: new command HTTP behavior is tested offline
- **WHEN** CLI tests cover success, conflict and API unavailable cases for `ziniao new`
- **THEN** the tests assert HTTP request body, exit code and terminal output without starting a real WebAdmin API server or touching real `flows/`
