## ADDED Requirements

### Requirement: Self-heal remains compatible with command Agent config
`packages/self-heal` SHALL remain compatible with command-style Agent configs while WebAdmin adds discovery and chat adapters. Self-heal MUST preserve existing `heal.agents.<name>.command` behavior and MAY share overlapping command config fields; it MUST NOT depend on WebAdmin API discovery, chat adapter registry or `/api/chat/*`.

#### Scenario: existing self-heal command still works
- **WHEN** `heal.agents.openclaw.command` uses the existing placeholder format
- **THEN** self-heal renders and invokes it through the existing injectable `AgentRunner`

#### Scenario: command-style codex config is accepted
- **WHEN** self-heal config defines a command-compatible codex Agent
- **THEN** self-heal can render placeholders and report runner diagnostics without importing WebAdmin API code

### Requirement: Self-heal validation remains offline
Self-heal SHALL keep tests and baseline validation offline after command config alignment. Tests MUST use mock `AgentRunner`, temporary repo/data roots and fixed clock; tests MUST NOT call real codex、Claude Code、OpenClaw Gateway、ZClaw bridge or local browser automation.

#### Scenario: tests use mock runners
- **WHEN** self-heal tests cover command-style Agent config compatibility
- **THEN** they use mock runners rather than real Agent CLIs

#### Scenario: package boundary remains intact
- **WHEN** `pnpm security:scan` runs
- **THEN** `packages/self-heal` still does not import WebAdmin API, directly access ZClaw bridge or open local browsers
