## ADDED Requirements

### Requirement: WebAdmin frontend flow authoring UI
WebAdmin frontend SHALL provide UI controls on the flows page to create a flow and edit extract scripts referenced by a flow. The UI MUST call same-origin `/api/*` endpoints, MUST reuse equivalent DTO types from `@ziniao/schemas`, and MUST NOT access ZClaw bridge, local filesystem paths, ZClaw API key, or local browser automation.

#### Scenario: create flow from flows page
- **WHEN** 用户在流程管理页输入 `flow_id` 和中文名并提交创建
- **THEN** frontend calls `POST /api/flows` with the form values, refreshes the flow list on success, and displays structured API errors on failure

#### Scenario: edit referenced extract
- **WHEN** 用户在 flow 编辑抽屉中打开一个 extract 引用
- **THEN** frontend calls `GET /api/extracts/:name` to load content and `PUT /api/extracts/:name` to save changes

#### Scenario: frontend authoring remains same-origin
- **WHEN** security scan checks frontend source after adding flow authoring UI
- **THEN** frontend source contains no direct `127.0.0.1:9481`、`/zclaw/tools`、`ZCLAW_API_KEY` or local browser automation fallback
