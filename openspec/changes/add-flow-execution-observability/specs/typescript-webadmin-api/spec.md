## ADDED Requirements

### Requirement: Unified flow run history API
WebAdmin API SHALL expose a unified flow run history API for manual and scheduled flow executions. The API MUST support filtering by `flow_id`, `schedule_id`, `source`, `status`, `limit` and `offset`; MUST return newest entries first; MUST include `run_id`, `flow_id`, `source`, `schedule_id`, `schedule_run_id`, `params`, `status`, `started_at`, `finished_at`, `duration_ms`, `error`, `failed_step`, `data_summary`, `output_refs` and `heal_summary` when available; and MUST preserve backward-compatible summaries for historical entries that only exist in `data/logs/runs.jsonl`.

#### Scenario: filter runs for a flow
- **WHEN** a client requests `/api/flows/account_health/runs?limit=20`
- **THEN** WebAdmin API returns the latest `account_health` manual and scheduled runs with status, duration, error summary and heal summary when available

#### Scenario: historical JSONL entry without WebAdmin index
- **WHEN** `data/logs/runs.jsonl` contains an older `account_health` failure that has no WebAdmin SQLite correlation row
- **THEN** WebAdmin API still returns a history item for that run with a stable synthetic id and marks detail-only fields that are unavailable as null or empty

#### Scenario: pagination and filters are applied
- **WHEN** a client requests `/api/runs?flow_id=account_health&source=schedule&status=failed&limit=10&offset=10`
- **THEN** WebAdmin API returns at most 10 matching scheduled failed runs after the first 10 newest matches

### Requirement: Flow run detail API
WebAdmin API SHALL expose a run detail API that returns the complete diagnostic view for a single flow execution. The detail MUST include the run history fields plus the persisted flow result snapshot, `failed_step` metadata, resolved self-heal result, matching heal events from `learnings/heals.jsonl`, heal context/prompt paths, and safe links to output files when available. Missing files MUST be represented as unavailable status instead of causing a server error.

#### Scenario: failed manual run detail includes root diagnostics
- **WHEN** a manual `account_health` run fails at an extract step and the client requests `/api/runs/<run_id>`
- **THEN** WebAdmin API returns the failure error, `failed_step.step_id`, `failed_step.tool` or `failed_step.action`, failed args when available, and the flow-engine heal metadata

#### Scenario: heal detail is merged into run detail
- **WHEN** a failed run triggered self-heal and `learnings/heals.jsonl` contains an event for the run's `heal_id`
- **THEN** the run detail includes the self-heal status, `heal_id`, `error_type`, `agent`, `prompt_path`, `heal_log_path`, skip or failure reason, and a resolvable `/api/heals/:healId` reference

#### Scenario: missing heal files do not break run detail
- **WHEN** the run index references a `heal_id` but the corresponding heal context file has been deleted
- **THEN** WebAdmin API returns the run detail with heal file availability set to false and does not fail the whole request

### Requirement: WebAdmin run self-heal orchestration
WebAdmin API SHALL trigger self-heal for failed manual and scheduled runs using `@ziniao/self-heal` when the flow and request have not explicitly disabled heal and the failure is triggerable. This orchestration MUST match CLI semantics for validation failures, flow-level `on_fail_final.heal: false`, known issue hits, cooldown, Agent runner failure and timeout. Default tests MUST use a mock `AgentRunner` and MUST NOT call a real OpenClaw, Claude, Cursor or other Agent CLI.

#### Scenario: failed manual run triggers mock self-heal
- **WHEN** a WebAdmin manual flow run fails with a triggerable `failed_step` in an offline API test using a mock `AgentRunner`
- **THEN** WebAdmin API records the run as failed, calls `triggerHeal()`, stores the returned `heal_id` and self-heal status, and writes/returns a run detail that shows self-heal was triggered

#### Scenario: flow disables self-heal
- **WHEN** a flow run fails and its definition contains `on_fail_final.heal: false`
- **THEN** WebAdmin API records the run failure and marks self-heal as skipped because the flow disabled it

#### Scenario: known issue skips Agent call
- **WHEN** a failed run matches a resolved entry in `learnings/known_issues.json`
- **THEN** WebAdmin API records self-heal as skipped with reason `known_issue_matched` and does not call the Agent runner

### Requirement: Schedule run correlation with flow run detail
WebAdmin API SHALL correlate each scheduler-triggered execution with a flow run detail. `schedule_runs` MUST retain schedule-level trigger status, while each schedule run that attempted a flow execution MUST expose a `run_id` or equivalent detail reference that resolves through the unified run detail API.

#### Scenario: schedule history links to run detail
- **WHEN** a client requests `/api/schedules/<sid>/runs`
- **THEN** each item that executed a flow includes `run_id`, flow status, duration, error summary and heal summary

#### Scenario: schedule failure before flow execution
- **WHEN** a schedule trigger is invalid or disabled before `runFlow()` starts
- **THEN** WebAdmin API records the schedule failure or skipped state and returns no `run_id` for a flow execution that never happened

#### Scenario: duplicate running flow is visible
- **WHEN** a schedule fires while the same flow already has a running WebAdmin execution
- **THEN** WebAdmin API records a skipped or conflict run entry that is visible in both schedule history and flow run history

### Requirement: WebAdmin run observability offline validation
WebAdmin API SHALL provide offline tests for unified run history, run detail, manual run self-heal, schedule correlation, historical JSONL fallback and path-safe heal/output references. These tests MUST use Fastify injection, temporary repo/data roots, mock tool client, mock Agent runner, fixed clock and no-op sleeper.

#### Scenario: baseline validates observability without bridge
- **WHEN** `pnpm validate:baseline` runs WebAdmin API tests after this change is implemented
- **THEN** the observability tests pass without connecting to `127.0.0.1:9481`, without opening a local browser and without calling a real Agent CLI
