## ADDED Requirements

### Requirement: WebAdmin-consumable self-heal result metadata
`packages/self-heal` SHALL provide self-heal trigger results and event logs that WebAdmin execution surfaces can correlate with failed flow runs. The result and event metadata MUST include `heal_id`, `flow_id`, `step_id`, `error_type`, final status or equivalent `success`/`skipped`/`dry_run` indicators, `agent`, `session_key`, `prompt_path`, `heal_log_path`, reason or error details when applicable, and MUST be safe to expose through WebAdmin without leaking secrets or full command credentials.

#### Scenario: successful trigger has correlation fields
- **WHEN** `triggerHeal()` invokes a mock Agent runner successfully for a failed `account_health` run
- **THEN** the returned result and appended heal event include `heal_id`, `flow_id`, `step_id`, `error_type`, `agent`, `session_key`, `prompt_path` and `heal_log_path`

#### Scenario: skipped trigger has reason
- **WHEN** `triggerHeal()` skips because of a known issue, cooldown, disabled config or disabled flow semantics provided by the caller
- **THEN** the returned result includes `skipped: true`, a stable reason and the same `heal_id`/path fields needed by WebAdmin detail views

#### Scenario: Agent failure remains structured
- **WHEN** the configured Agent runner fails, times out or is missing
- **THEN** `triggerHeal()` returns `success: false` with a user-visible error summary and appends a structured event when quota/cooldown semantics have been consumed

### Requirement: Self-heal observability remains offline and boundary-safe
Self-heal observability support SHALL remain within the existing `packages/self-heal` safety boundary. Tests for WebAdmin-consumable metadata MUST use a mock `AgentRunner`, temporary repo/data roots and fixed clock; MUST NOT depend on `@ziniao/zclaw`; MUST NOT access `127.0.0.1:9481`; MUST NOT open a local browser; and MUST NOT call a real OpenClaw, Claude, Cursor or other Agent CLI.

#### Scenario: metadata tests do not call real Agent
- **WHEN** self-heal tests cover WebAdmin correlation metadata
- **THEN** they use a mock runner and do not execute the configured real Agent command

#### Scenario: security scan preserves package boundary
- **WHEN** `pnpm security:scan` runs after this change is implemented
- **THEN** `packages/self-heal` still contains no direct ZClaw bridge access, local browser open command or browser automation dependency
