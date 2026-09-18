# Goal 17 offline edit-contract evaluation

- Date: 2026-09-09 (Asia/Bangkok)
- Branch: `feat/AI-MPC-Intergate`
- Baseline HEAD: `9f7ca3607c94c9197891cfb9680dd584e5cdf0b3`
- Result commit: pending; this report and implementation are still in the working tree
- Corpus: `frontend/src/core/ai/evals/goal17-edit.v1.json`
- Corpus schema: `1.0`
- Corpus SHA-256: `1B7BBB690BCBF3ACBE5C1F2C63FA20CC116A91638E9F89CE7262EE2ADCFE3086`

## Scope

This deterministic offline evaluation executes reviewed provider-neutral tool plans against a
fresh structural fixture. It covers Vietnamese and English prompts tagged for selection, pronoun,
workspace/provenance reference, named alias, no-match, multi-match, transform preview and stale
revision conflict.

It proves target-resolution and edit-contract behavior after a tool plan has been produced. It
does not claim that a live language model selected the expected plan; online provider scoring is a
separate pending verification.

## Result

- Corpus coverage check: passed.
- Offline scenarios: 10/10 passed.
- Goal 17 plus Copilot focused tests: 39/39 passed.
- Full frontend fixture: 148/148 passed.
- Indexed 100,000-member queries in the latest full fixture: section P95 24.0 ms and material
  P95 30.8 ms (gate <= 100 ms).
- Focused Goal 17 ESLint: passed with zero warnings.
- TypeScript and production build: passed; the existing large bundle warning remains.
- Dry-run/preview now returns the exact planned change set. No-op edits report zero affected
  entities, create no undo token and cannot shadow the prior meaningful undo.
- Provider-authored move/update/section/material/transform/property edits are forced to preview in
  the Copilot orchestration even if a provider emits `preview:false`.

## Reproduction

From `frontend`:

```powershell
node --test --test-concurrency=1 --experimental-strip-types src/core/ai/Goal17EditEval.test.ts
npm run test:fixture
npm run build
```

The live-provider runner uses the same in-memory fixture, so it cannot mutate the open workspace:

```powershell
npm run eval:goal17:online -- --session-id SESSION_ID --connection-id CONNECTION_ID --model MODEL_ID --report ../docs/evals/goal17-edit-online.json
```

If the backend process uses its `ANTHROPIC_API_KEY`/`COPILOT_MODEL` environment fallback, omit the
session, connection and model arguments. The report never includes the API key.

## Remaining evidence before closing Goal 17

- Run the same bilingual prompts against at least one configured live provider and retain tool-call
  validity/task-completion results.
- Complete and sign off the four live viewport user-verification journeys in the roadmap.
- Replace `Result commit: pending` with the commit SHA containing the corpus and implementation.
