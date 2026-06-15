## ADDED Requirements

### Requirement: WebAdmin cutover evidence
WebAdmin API SHALL provide M7 preflight evidence that the TypeScript WebAdmin backend can serve the migrated frontend and cover the current core WebAdmin API surface offline. Evidence MUST include route/injection tests or smoke output for flows, monitoring, schedules, chat SSE, static frontend present, static frontend missing, and local-only manual run behavior.

#### Scenario: WebAdmin API smoke evidence exists
- **WHEN** implementation finishes this change
- **THEN** tasks or docs record the commands and results for WebAdmin API tests/smoke covering core routes and static frontend serving

#### Scenario: evidence does not require real bridge
- **WHEN** WebAdmin API smoke evidence is generated
- **THEN** it uses mock tool client, mock Agent runner, temporary data root or local-only flow and does not call real ZClaw bridge

## MODIFIED Requirements

### Requirement: Static frontend dist serving
WebAdmin API SHALL serve the migrated frontend build output from `apps/webadmin-frontend/dist` and provide SPA fallback for non-API routes. Missing frontend dist MUST return an API-readable status instead of failing server startup. The application MAY allow tests or explicit config to inject another dist path, but the default repo-local production path MUST be `apps/webadmin-frontend/dist`.

#### Scenario: migrated frontend dist served
- **WHEN** `apps/webadmin-frontend/dist/index.html` exists and a client requests `/`
- **THEN** WebAdmin API returns the built frontend entrypoint and serves its static assets

#### Scenario: missing frontend dist keeps API available
- **WHEN** `apps/webadmin-frontend/dist` is absent
- **THEN** WebAdmin API still starts and returns a clear status for frontend requests while REST/SSE API endpoints remain available
