## ADDED Requirements

### Requirement: WebAdmin flow authoring DTO schemas
系统 SHALL provide TypeScript and Zod schemas for WebAdmin flow authoring DTOs. The schemas MUST include `CreateFlowRequest`、`CreateFlowResponse`、`SaveExtractRequest`、`ExtractDetail` and `FlowTemplateResponse`; MUST be exported from `@ziniao/schemas`; and MUST be included in the WebAdmin JSON Schema export.

#### Scenario: create flow request parses
- **WHEN** schema parses `{ "id": "sample_flow", "name": "样例流程" }`
- **THEN** it accepts the request as `CreateFlowRequest` and preserves optional `content` when provided

#### Scenario: extract response parses
- **WHEN** schema parses an extract detail response containing `name`、`path`、`exists` and `content`
- **THEN** it accepts the response as `ExtractDetail` and allows `content` to be `null` when the extract does not exist

#### Scenario: JSON Schema export includes authoring DTOs
- **WHEN** the WebAdmin API JSON Schema export script runs
- **THEN** the generated schema includes definitions for flow authoring request and response DTOs
