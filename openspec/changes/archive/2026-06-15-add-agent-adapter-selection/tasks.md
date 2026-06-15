## 1. Planning Review

- [x] 1.1 Run OpenSpec status/validation for the clarified proposal artifacts.
- [x] 1.2 Ask a sub-agent to review proposal/design/specs against the two clarifications.
- [x] 1.3 Apply required proposal/design/spec/task adjustments from the review before implementation.

## 2. Schema and Config Foundation

- [x] 2.1 Extend `packages/schemas/src/webadmin.ts` with generic Agent metadata, diagnostics, capabilities and chat preference DTOs.
- [x] 2.2 Update schema tests and JSON Schema export expectations for the new DTOs.
- [x] 2.3 Refactor `apps/api/src/config.ts` so repo config is an overlay over discovered Agents, not the only Agent source.
- [x] 2.4 Update `config.example.json` with auto-discovery notes plus optional OpenClaw/codex/Claude Code overrides.
- [x] 2.5 Verify schema/config foundation with targeted tests and update this task group when green.

## 3. Backend Discovery and Adapter Registry

- [x] 3.1 Add injectable command locator/discovery for supported Agents: OpenClaw, codex and Claude Code.
- [x] 3.2 Add `ChatAgentAdapter` registry and convert existing OpenClaw Gateway chat to the `openclaw-gateway` adapter.
- [x] 3.3 Implement safe command adapter with argv array execution, placeholder rendering, timeout/kill, output truncation and structured diagnostics.
- [x] 3.4 Implement codex and Claude Code adapter definitions on top of the command adapter.
- [x] 3.5 Verify discovery/adapter behavior with mock locator/command tests: empty config returns OpenClaw、codex and Claude Code metadata; missing CLI Agents remain metadata with `available: false`.

## 4. Chat API Preference and Routing

- [x] 4.1 Extend `GET /api/chat/agents` to return discovered/configured generic metadata and secret-safe diagnostics.
- [x] 4.2 Add WebAdmin-owned chat default preference storage/API or equivalent session-update persistence.
- [x] 4.3 Update session creation to use stored preference, then effective backend default, with fallback for unavailable Agents.
- [x] 4.4 Update chat send routing to use effective adapter metadata and reject disabled/unknown Agents.
- [x] 4.5 Verify API behavior with Fastify injection tests for metadata, preference, fallback and adapter failure no-fallback.

## 5. Frontend Metadata-Driven Selector

- [x] 5.1 Update `apps/web/src/api.ts` to consume shared Agent metadata/preference DTOs.
- [x] 5.2 Replace chat Agent selector behavior so it renders only from backend metadata, with no hard-coded Agent-specific branches.
- [x] 5.3 Persist selection through the WebAdmin API and make new sessions use backend default/preference.
- [x] 5.4 Show unavailable diagnostics generically and prevent sending with unavailable Agents.
- [x] 5.5 Verify frontend metadata-driven behavior with a future unknown Agent metadata fixture/review gate, then run typecheck/build and update this task group when green.

## 6. Self-Heal Compatibility

- [x] 6.1 Keep existing self-heal command Agent config working while aligning overlapping command fields with shared config semantics.
- [x] 6.2 Add self-heal tests for command-style codex/Claude config using mock `AgentRunner`.
- [x] 6.3 Verify `packages/self-heal` does not import WebAdmin API or call `/api/chat/*`.

## 7. Security, Documentation and Local Smoke

- [x] 7.1 Update `scripts/security-scan.ts` only as needed for safe API-side command adapter code while preserving browser/ZClaw restrictions.
- [x] 7.2 Update docs for Agent auto-discovery, config overlay, default preference and optional local smoke.
- [x] 7.3 Add or document optional local smoke for `codex exec` and `claude -p`.
- [x] 7.4 Run optional local smoke on this machine and record result without making it part of baseline.
  - Result: `codex exec --sandbox read-only` starts but local Codex config returns a model/version compatibility error before producing a usable answer; `claude --version` returns `2.1.50`, while `claude -p` did not return within 2 minutes and was interrupted. Baseline remains mock/offline only.
- [x] 7.5 Verify `pnpm security:scan`.

## 8. Final Validation and Archive

- [x] 8.1 Run `pnpm typecheck`.
- [x] 8.2 Run `pnpm test`.
- [x] 8.3 Run `pnpm build`.
- [x] 8.4 Run `pnpm schemas:export -- --check`.
- [x] 8.5 Run `pnpm validate:baseline` and confirm it remains offline.
- [x] 8.6 Run `openspec validate --specs --strict`.
- [x] 8.7 Archive `add-agent-adapter-selection`.
- [x] 8.8 Commit the completed implementation, docs and OpenSpec archive.
