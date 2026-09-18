# Processing handoff

## AI material and section catalogue tools — 2026-09-09

- Added provider-neutral `create_material` and `create_section` tools. They are exposed in
  Modeling, Generate and Agent modes, while Inspect remains query-only and Edit remains scoped to
  existing selected entities.
- Provider-authored catalogue creation is always previewed before the Apply UI commits it. Apply
  uses the existing Command Gateway transaction, revision, audit, idempotency and undo behavior.
- `create_material` accepts explicit Pa/kPa/MPa/GPa modulus/strength values, kg/m3 or t/m3 density,
  optional thermal expansion and metadata, and validates physical ranges.
- `create_section` supports every current `SectionType`, explicit m/mm/cm/ft/in dimensions,
  validates the referenced material and required family dimensions, and rejects invalid wall/web/
  flange thicknesses before preview or commit.
- Backend tool allowlists and the provider system prompt now expose the two tools and instruct the
  provider to create a missing material before a dependent section.
- Verification: frontend fixture **161/161 passed**, focused catalogue/Copilot ESLint passed,
  backend Copilot **26/26 passed**, production build passed; the existing large-chunk warning remains.

## Session handoff — 2026-09-09

### Repository state

- Branch: `feat/AI-MPC-Intergate`.
- Current HEAD: `bb1fc08 feat: enhance CopilotPanel with prompt handling and retry functionality`.
- Remote `origin/feat/AI-MPC-Intergate` is at the same commit.
- Worktree was clean at the end of the review.
- Changes reviewed since Goal 15 commit `35d9d40`:
  - `553a6ce feat: add NVIDIA provider support and enhance error handling in Copilot`.
  - `bb1fc08 feat: enhance CopilotPanel with prompt handling and retry functionality`.

### Review conclusion

- NVIDIA NIM was added consistently to backend and frontend, using the preset base URL
  `https://integrate.api.nvidia.com/v1`.
- GroqCloud was added consistently to backend and frontend, using the OpenAI-compatible preset
  base URL `https://api.groq.com/openai/v1`; model IDs are discovered from `/models`.
- Per-connection outbound rate-limit settings are available in Copilot provider settings.
  Auto mode follows provider quota/reset headers without local RPM/TPM reservations; Manual mode
  enforces configured rolling RPM/TPM. Both enforce concurrency and bounded `429` retries honoring
  `Retry-After`. Long learned resets are confirmed with the provider instead of causing a local
  `Provider quota queue wait exceeded` false positive.
- Multi-round tool results are retained for the full logical turn instead of being discarded after
  each provider round. Repeated read-only cycles such as `get_sections -> get_model_summary` are
  detected before another duplicate execution, then Copilot asks the provider for a final answer
  with no tools exposed. Exhausting six tool rounds now follows the same finalization path instead
  of emitting the generic `Copilot exceeded the six-round conversation budget` error.
- Backend includes a mocked connection test for NVIDIA.
- Frontend now formats FastAPI validation errors more clearly, supports Enter to send and
  Shift+Enter for a new line, and exposes Retry on user messages.
- These changes do not break the current automated tests or production build.
- Goal 16 has progressed beyond `Planned`, but must remain active/in progress rather than
  completed.

### Issues to address before closing Goal 16

1. **Mutation Retry duplicate safety — resolved in working tree on 2026-09-09.**
   - Retry is offered once and only after a failed turn.
   - The retry preserves a logical turn ID; tool-call IDs are derived deterministically from
     logical turn, round and call position, so an already committed mutation is replayed rather
     than executed again.
   - If the provider changes a tool call in the same retry slot, execution fails closed with
     `IDEMPOTENCY_CONFLICT` instead of applying a different mutation.
   - Regression coverage includes replay without duplicate entity creation and changed-content
     conflict handling.

2. **Streaming is currently simulated rather than provider-native.**
   - Backend waits for the entire provider response and then emits the completed text in
     80-character SSE chunks.
   - Implement actual provider streaming if Goal 16 requires useful time-to-first-token.

3. **Cancel does not stop an in-flight provider request.**
   - `/cancel/{request_id}` records a cancellation marker.
   - The marker is checked only after `run_copilot_turn()` returns, so the upstream provider
     request continues and may still consume latency/tokens.
   - Current behavior does prevent unfinished tool results from being executed in the browser.
   - Add an in-flight cancellation test; the existing test covers only cancellation before the
     provider call starts.

4. **Remaining Goal 16 deliverables/gates.**
   - Add Zoom to affected entities; Select already exists.
   - Complete/verify the natural-language flow for changing material.
   - Add UI/E2E coverage for prompt -> tool -> viewport -> preview/apply -> undo.
   - Add the 50-prompt Vietnamese/English evaluation corpus.
   - Verify two simultaneous conversation/model sessions do not cross-route state or commands.
   - Perform a live NVIDIA provider verification; current NVIDIA test is mocked.
   - Make the new Copilot module lint-clean. Current local findings are one
     `no-constant-condition` error for `while (true)` and one `useEffect` dependency warning.

### Verification results

- Frontend `npm run test:fixture`: **122/122 passed**, including Mutation Retry and multi-round
  tool-result/loop-guard regressions.
- Backend Copilot/rate-governor tests: **20/20 passed**, including Groq defaults, per-connection create/update policy,
  header parsing, `429` retry/status preservation, manual queue timeout and Auto no-false-positive
  coverage, plus provider-compatible tool-free finalization.
- Frontend `npm run build`: **passed**.
- `git diff --check`: **passed**.
- Repository-wide `npm run lint` still has existing legacy violations; the focused Copilot files
  are lint-clean after removing the prior constant-loop error and effect-dependency warning.

### Goal checklist updated

`VIEWER_IMPLEMENTATION_GOALS.md` now records Goal 16 as:

> `In progress — core MVP implemented; true streaming/cancel, P0 UI/E2E and 50-prompt eval pending`

The Goal 16 POC statement saying streaming, cancel, mode/model selector, persistence and session
isolation are all absent is now historical/outdated. Keep it explicitly labeled as the historical
POC record, then add a new implementation record covering:

- Generic `/api/copilot/turn` and `/api/copilot/turn/stream` endpoints.
- Mode/model/provider selection and BYOK server-side connections.
- Multi-round provider-neutral tool execution.
- Context revision/stale-model guard.
- Preview, Apply, Reject, Undo and Select affected entities.
- Session message/context persistence.
- NVIDIA NIM preset and improved provider error display.
- GroqCloud preset with server-side BYOK and model discovery.
- Per-provider connection rate-limit UI and server-side outbound governor.
- Current automated verification: 122 frontend tests, 20 Copilot/rate-governor backend tests and
  production build pass.

Goal 14 and Goal 15 statuses do not need to change. At this handoff point Goal 16 remained active;
the later Goal 17 continuation below supersedes that instruction and records the user's explicit
waiver for the deferred Goal 16 gates.

### Suggested continuation order

1. Correct streaming/cancellation semantics and add in-flight cancellation tests.
2. Add focused Copilot UI tests beyond the Mutation Retry policy/idempotency coverage.
3. Complete missing P0 flows, Zoom and UI/E2E verification.
4. Run the 50-prompt evaluation and concurrent-session gate.
5. Decide whether Goal 16 can close.

## Goal 17 continuation — 2026-09-09

### Roadmap transition

- The user explicitly requested continuing with Goal 17. This records the required waiver to move
  on while Goal 16 still has provider-native streaming/in-flight cancellation, P0 UI/E2E and the
  50-prompt evaluation pending.
- Goal 16's remaining gates are deferred, not marked as passed. Goal 17 is now the only active goal.

### Implemented

- Expanded the deterministic query DSL with exact name/type, group, level, grid, semantic role,
  section, material, connectivity, coordinate, selection and hidden-state filters.
- Added `resolve_targets` and `remember_targets` for workspace/provenance-based reference resolution,
  explicit zero/ambiguous-match behavior and conversation-scoped entity aliases.
- Added `change_material`, `transform_entities` and `update_entity_properties` to the provider-neutral
  registry, policy, executor and backend Copilot tool allowlists/prompt.
- Relative transforms support move/copy/rotate/mirror/array. Copy/array preserve copied member-node
  topology. Direct member transforms reject shared-node collateral changes outside the target set
  unless the shared node is explicitly included.
- Batch edits cover section/material/release/load/support/metadata. Generic property edits reject
  topology rewiring; node metadata now persists through `MoveNodes` rather than being silently lost.
- Query and edit operations use the existing Command Gateway for preview, validation, atomic apply,
  revision/audit and undo. Material changes reuse or clone a compatible section while preserving
  member topology and parametric ownership.
- Copilot stale-context UX now reports the exact planned, current and provider revisions.
- `Clear context` now creates a new executor session so aliases/provenance/replay IDs cannot leak
  across conversations. Deleted alias targets are purged before an ID can be reused.
- Preview cards carry their model revision; Apply fails closed when a manual/model edit made the
  preview stale.
- Provider-authored structural edit tools are forcibly previewed even if the provider emits
  `preview:false`; commit arguments are generated only by the Apply UI.
- Command Gateway dry-runs now return exact planned change sets. No-op edits report zero affected,
  emit no undo token and cannot shadow the previous meaningful undo operation.
- Query candidate sets use existing section/material/workspace/relationship indexes before filter
  evaluation; unknown section/material IDs fail explicitly.
- Added the versioned bilingual offline corpus `frontend/src/core/ai/evals/goal17-edit.v1.json` and
  reproducible report `docs/evals/goal17-edit-offline-2026-09-09.md`.
- Added `npm run eval:goal17:online`: it calls a configured backend provider but executes all returned
  tools against a fresh in-memory fixture, never the open workspace. It records expected/actual tool
  sequences and exact target/preview/revision checks without printing API keys.

### Verification

- Frontend `npm run test:fixture`: **148/148 passed**.
- Goal 17 offline edit-contract corpus: **10/10 scenarios passed**; coverage includes selection,
  pronoun/reference, no-match, multi-match and stale revision in Vietnamese and English.
- Goal 17 100,000-member indexed filters: section **P95 24.0 ms**, material **P95 30.8 ms**
  in the latest full run (gate <= 100 ms).
- 1,000-node transform regression: one transaction, one revision, one undo step.
- Backend Copilot/rate-governor tests: **21/21 passed** (13 existing dependency warnings).
- Frontend `npm run build`: **passed** (existing large-chunk warning remains).
- Focused ESLint for Goal 17 and stale-conflict files: **passed**.

### Remaining before Goal 17 can close

- Run the versioned Vietnamese/English corpus against at least one configured live provider and
  retain tool-call validity/task-completion results; the deterministic offline contract run is done.
  Current runtime attempt stopped before an outbound provider request because the new backend session
  had no provider connection (`Configure a provider connection before chatting`).
- Manually verify in the live viewport: select columns by level, change them to I500, move selected
  nodes 250 mm in X, and hide edge-frame bracing; verify summaries and undo.
- Attach benchmark/eval/manual evidence to the final Goal 17 commit SHA.

## Local model providers — 2026-09-09

### Added

- Copilot BYOK now supports local OpenAI-compatible runtimes: `ollama`
  (`http://localhost:11434/v1`), `lmstudio` (`http://localhost:1234/v1`) and a generic
  `local` provider (vLLM, llama.cpp server, Jan, ...) with a user-supplied base URL.
  Connections need no API key; model IDs auto-discover from `/models` (e.g. `llama3.2:3b`)
  or can be typed manually. Everything is configured from the existing Copilot settings UI
  (provider dropdown, editable Base URL, optional API key).
- Gate: local providers are allowed automatically while the backend runs outside production
  (`ENVIRONMENT != production`, the same variable `backend/main.py` reads; the Docker image
  sets `production`). Deployed instances must set `COPILOT_ALLOW_LOCAL_PROVIDERS=1`.
- Security posture preserved: production still rejects local/private URLs by default; local
  base URLs must be http(s) without credentials and point at loopback, RFC1918 private
  ranges or `host.docker.internal`; link-local/metadata addresses (`169.254.169.254`) and
  public hosts are rejected.
- OpenAI-compatible tool-call parsing now accepts `arguments` as a JSON string or an
  already-parsed object, tolerating local runtime variations.
- `_headers()` omits `Authorization` when a connection has no API key; `_public_connection()`
  reports `keyHint: "local"` for keyless connections.
- Small-model tool-call robustness: flattened/singular `query_entities` arguments emitted by
  small local models (`semanticRole: 'member'`, `materialId: [2]`, `length: 6`, placeholder junk
  such as `[range]`) are normalized into the documented `{collection, filter}` shape in
  `CopilotToolPolicy` before execution; `query_entities` schema-violation errors now list the
  allowed keys so the provider can self-correct on retry; the backend tool system prompt
  documents the exact `query_entities` argument contract with an example.

### Verification

- Backend `tests/test_copilot.py`: **25/25 passed** (16 existing + 9 new: local connection
  without key, auto-discovery, production opt-in flag, public/metadata/credential URL
  rejection, loopback/private allow-list, custom-local base URL requirement, cloud key still
  required, keyless headers, string/object tool arguments). Running the whole `tests/` folder
  in one process hits the pre-existing MCP `StreamableHTTPSessionManager` single-run conflict
  between test modules; unrelated to this change.
- Frontend: `tsc` passed and `vite build` transformed all 11,887 modules successfully
  (verified against `--outDir dist_verify`); focused ESLint for `CopilotPanel.tsx` passed.
  The default `npm run build` currently fails at Vite's out-dir cleanup with
  `EPERM ...\frontend\dist\assets` because the pre-existing `dist` folder is locked by the
  environment (reproduces without this change); clear the `dist` lock and rebuild.

### Notes / limitations

- Edit/Agent modes rely on provider tool calling; small local models (e.g. `llama3.2:3b`)
  support tools but may emit malformed arguments more often than larger models. Malformed
  arguments fail closed with `Provider returned invalid tool arguments`.
- Copilot streaming remains simulated (chunked after the full response), so local time-to-
  first-token gains are not visible in the UI yet (existing Goal 16 issue #2).
