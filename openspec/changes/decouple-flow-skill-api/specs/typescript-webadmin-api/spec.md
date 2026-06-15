## MODIFIED Requirements

### Requirement: Flow management API
WebAdmin API SHALL expose REST endpoints for flow management and flow authoring. It MUST list non-template flows, return flow detail with extract references, provide a flow template response, create new flow definitions from validated content or a server-owned template, validate flow content through `@ziniao/flow-engine`, save valid flow JSON with backup retention, reject invalid saves without mutating the existing flow, read and write extract scripts under the `extracts/` root with normalized allowlist path checks, and accept manual run requests with flow-level duplicate-run protection.

#### Scenario: list flows excludes template
- **WHEN** a client requests the flows list
- **THEN** the response includes repository flow definitions except `_template.json`, with recent run summary when available

#### Scenario: invalid flow save does not mutate file
- **WHEN** a client submits invalid JSON or a flow definition that fails TS flow validation
- **THEN** WebAdmin API returns a validation error and the existing `flows/<flow_id>.json` content remains unchanged

#### Scenario: manual run duplicate is rejected
- **WHEN** a flow already has an accepted running task and another manual run for the same flow is requested
- **THEN** WebAdmin API returns a conflict response or equivalent structured status without starting a second run

#### Scenario: create flow from server template
- **WHEN** a client submits `POST /api/flows` with `{ "id": "sample_flow", "name": "样例流程" }` and no existing `flows/sample_flow.json`
- **THEN** WebAdmin API creates a valid flow definition using a server-owned template, validates it, writes `flows/sample_flow.json`, and returns the created flow id and content

#### Scenario: duplicate flow creation is rejected
- **WHEN** a client submits `POST /api/flows` for an id whose `flows/<id>.json` already exists
- **THEN** WebAdmin API returns a conflict response and does not overwrite the existing file

#### Scenario: extract path traversal is rejected
- **WHEN** a client requests `GET /api/extracts/:name` or `PUT /api/extracts/:name` with a name that resolves outside the `extracts/` root
- **THEN** WebAdmin API rejects the request and does not read or write the target path

#### Scenario: extract can be saved and read
- **WHEN** a client saves `{ "content": "<script>" }` to `PUT /api/extracts/sample.js` and then requests `GET /api/extracts/sample.js`
- **THEN** WebAdmin API returns the same script content and metadata indicating the extract exists

## ADDED Requirements

### Requirement: Flow authoring API offline validation
WebAdmin API SHALL test flow authoring endpoints offline. Tests MUST use Fastify injection, temporary repo/data roots and mock runner dependencies; they MUST NOT call real ZClaw bridge, open a store, visit a page, execute a real flow through bridge, or open a local browser.

#### Scenario: authoring tests run offline
- **WHEN** `pnpm test` runs WebAdmin API tests for `POST /api/flows`, `GET /api/flows/template`, `GET /api/extracts/:name` and `PUT /api/extracts/:name`
- **THEN** the tests complete using temporary files and in-process HTTP injection without contacting `127.0.0.1:9481`
