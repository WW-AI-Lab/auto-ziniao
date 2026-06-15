## ADDED Requirements

### Requirement: Metadata-driven Agent selector
WebAdmin frontend SHALL render the chat Agent selector entirely from backend Agent metadata. The frontend MUST NOT hard-code supported Agent names, CLI commands, adapter-specific options or type-specific business logic for OpenClaw、codex、Claude Code or future Agents.

#### Scenario: new backend Agent appears without frontend code change
- **WHEN** `/api/chat/agents` returns a new available Agent item with standard metadata
- **THEN** the chat selector displays and can select that Agent without frontend source changes for that Agent type

#### Scenario: unavailable Agent is shown generically
- **WHEN** an Agent item has `available: false` and diagnostic text
- **THEN** the frontend shows the unavailable state using generic metadata and prevents sending with that Agent

### Requirement: Chat Agent choice is remembered
WebAdmin frontend SHALL persist Agent selection through WebAdmin API. Changing the active session Agent MUST update the session and request default preference persistence; creating a new session MUST rely on the API-provided default/effective Agent instead of frontend-only local defaults.

#### Scenario: selected Agent is next default
- **WHEN** the user selects Claude Code in the chat selector
- **THEN** the next new chat session defaults to Claude Code if the backend still marks it available

#### Scenario: reload uses backend default
- **WHEN** the chat page reloads after the user selected codex
- **THEN** the page fetches backend Agent metadata/default and uses codex for new sessions if still available

### Requirement: Frontend remains API-only
WebAdmin frontend SHALL access Agent data only through same-origin WebAdmin API and shared schemas. It MUST NOT read repo config, inspect local PATH, execute local commands, access ZClaw bridge, open local browsers or import browser automation dependencies.

#### Scenario: frontend builds with shared DTOs
- **WHEN** frontend typecheck/build runs
- **THEN** Agent selector code compiles using shared WebAdmin DTO types

#### Scenario: security scan finds no local execution
- **WHEN** `pnpm security:scan` inspects frontend source
- **THEN** no frontend file invokes Agent CLI, opens local browser or accesses ZClaw bridge
