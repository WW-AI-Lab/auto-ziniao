## ADDED Requirements

### Requirement: Chat Agent metadata API uses discovery
WebAdmin API SHALL build `GET /api/chat/agents` from backend Agent discovery plus config overlay. The response MUST include the effective default Agent, discovered/configured Agent metadata, availability and bounded diagnostics; it MUST NOT expose secrets, full command arrays, prompt content or sensitive local paths.

#### Scenario: discovered Agents are listed without config
- **WHEN** repo config does not define chat Agents and mock locator finds codex and Claude Code commands
- **THEN** `GET /api/chat/agents` returns OpenClaw、codex and Claude Code metadata

#### Scenario: config overlay changes metadata
- **WHEN** repo config overrides a discovered Agent label and timeout
- **THEN** `GET /api/chat/agents` returns the overridden label and timeout

#### Scenario: secrets are not exposed
- **WHEN** repo config includes token, token path or command details
- **THEN** `GET /api/chat/agents` omits those fields

### Requirement: Configurable WebAdmin chat Agent adapters
WebAdmin API SHALL route chat sends through an adapter registry selected by effective Agent metadata. The registry MUST support existing OpenClaw Gateway RPC and new codex/Claude Code CLI adapters; adapter failures MUST be persisted and emitted as structured chat errors; WebAdmin API MUST NOT fallback from one adapter type to another.

#### Scenario: OpenClaw uses Gateway RPC
- **WHEN** a session uses `type: "openclaw-gateway"`
- **THEN** WebAdmin API calls the OpenClaw Gateway RPC adapter and does not execute a CLI delivery command

#### Scenario: codex CLI handles send
- **WHEN** a session uses discovered `type: "codex-cli"`
- **THEN** WebAdmin API invokes the codex CLI adapter and persists the assistant result

#### Scenario: Claude Code CLI handles send
- **WHEN** a session uses discovered `type: "claude-code-cli"`
- **THEN** WebAdmin API invokes the Claude Code CLI adapter and persists the assistant result

#### Scenario: failed adapter has no fallback
- **WHEN** codex CLI returns non-zero exit or times out
- **THEN** WebAdmin API marks the assistant message failed, emits an SSE error and does not retry through OpenClaw or Claude Code

### Requirement: Chat Agent default preference
WebAdmin API SHALL persist the user's last selected chat Agent as WebAdmin-owned state. Creating a chat session without explicit `agent` MUST use the stored preference when still available; otherwise it MUST use the effective backend default. Updating a session Agent MAY also update the stored preference when requested by the frontend.

#### Scenario: selected Agent becomes default
- **WHEN** a user changes the active session Agent to codex and asks to remember it
- **THEN** subsequent `POST /api/chat/sessions` without explicit `agent` creates a codex session

#### Scenario: unavailable preference falls back
- **WHEN** stored preference points to a disabled or missing Agent
- **THEN** new session creation falls back to the effective backend default

### Requirement: WebAdmin API validation remains offline
WebAdmin API SHALL test discovery, metadata, adapter routing and preference behavior offline. Tests MUST use mock locators/adapters/commands and Fastify injection; tests MUST NOT call real codex, Claude Code, OpenClaw Gateway, ZClaw bridge or local browser.

#### Scenario: tests discover mock Agents
- **WHEN** WebAdmin API tests run
- **THEN** they verify codex/Claude discovery using mock command locator rather than real PATH

#### Scenario: security scan preserves boundary
- **WHEN** `pnpm security:scan` runs
- **THEN** WebAdmin API still does not directly access ZClaw bridge, read ZClaw API key, open local browsers or depend on browser automation packages
