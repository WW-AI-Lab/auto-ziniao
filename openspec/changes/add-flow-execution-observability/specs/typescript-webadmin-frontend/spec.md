## ADDED Requirements

### Requirement: Flow page run history and detail view
WebAdmin frontend SHALL let users inspect past flow executions from the `/flows` page. The flow list MUST provide a history/detail entry for each flow; the history view MUST show status, source, trigger time, duration, params summary, error summary and self-heal summary; and selecting a run MUST show the unified run detail returned by WebAdmin API.

#### Scenario: user opens account_health failure from flow list
- **WHEN** the user clicks the run history or detail action for `account_health` on `/flows`
- **THEN** the UI displays past `account_health` runs including the latest failed run, its failure reason and whether self-heal was triggered, skipped or failed

#### Scenario: run detail shows failed step
- **WHEN** the user selects a failed run whose API detail includes `failed_step`
- **THEN** the UI displays the failed step id, tool/action, error message and failed args when available

#### Scenario: run detail shows success result
- **WHEN** the user selects a successful run whose API detail includes `data_summary` or output references
- **THEN** the UI displays the success summary and safe output references instead of only showing a generic success tag

### Requirement: Schedule page run detail correlation
WebAdmin frontend SHALL let users inspect the full flow execution detail from the `/schedules` page. The expanded schedule run table MUST display schedule trigger status and MUST provide a detail action for entries that include `run_id`; that detail action MUST open the same run detail presentation used by `/flows`.

#### Scenario: user opens scheduled run detail
- **WHEN** the user expands a schedule on `/schedules` and clicks a run with `run_id`
- **THEN** the UI opens the unified run detail and shows the associated flow id, schedule id, status, params, failure details and self-heal status

#### Scenario: schedule preflight failure has no flow detail
- **WHEN** a schedule run failed before a flow execution and has no `run_id`
- **THEN** the UI shows the schedule-level error and does not present a broken flow detail link

### Requirement: Self-heal visibility in execution detail
WebAdmin frontend SHALL explicitly show self-heal status for failed runs. The UI MUST distinguish at least `not_triggered`, `triggered`, `skipped`, `success`, `failed`, `timeout`, `dry_run` and `disabled` states when present in API data; MUST show `heal_id`, `error_type`, Agent name, reason/error, and links or references for heal context and prompt when available; and MUST avoid claiming that self-heal ran when API data says it did not.

#### Scenario: failed run skipped by known issue
- **WHEN** a run detail contains `heal_summary.status = "skipped"` and reason `known_issue_matched`
- **THEN** the UI labels self-heal as skipped by known issue and does not describe it as OpenClaw executed

#### Scenario: failed run triggered OpenClaw
- **WHEN** a run detail contains a triggered self-heal event with `agent = "openclaw"`
- **THEN** the UI displays the agent name, `heal_id`, prompt/context references and final trigger result

### Requirement: Frontend run observability validation
WebAdmin frontend SHALL keep run observability type-safe and offline-validatable. Frontend API types MUST come from `@ziniao/schemas/webadmin`; validation MUST use typecheck/build and MUST NOT start ZClaw bridge, open a browser, execute a real flow or call a real Agent CLI.

#### Scenario: frontend builds with shared run DTOs
- **WHEN** frontend typecheck/build runs after the observability UI is implemented
- **THEN** `/flows` and `/schedules` compile using shared WebAdmin run DTOs from `@ziniao/schemas/webadmin`
