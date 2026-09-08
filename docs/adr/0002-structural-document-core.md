# ADR 0002: StructuralDocument as the engineering-state authority

- Status: Accepted for migration
- Date: 2026-09-08
- Document version: 1
- Transport schema: 1.0

## Decision

`frontend/src/core/structural/StructuralDocument.ts` is the authoritative, renderer-
independent engineering state. It stores normalized stable-ID records in engineering
Z-up coordinates, validates references before commit, increments one revision per
successful reconciliation, and emits deterministic entity change sets.
Organizational and parametric ownership links use `{ collection, id }` references so
equal numeric IDs in different entity collections remain unambiguous. Cascade deletes
remove these references in the same document revision.

`WorkspaceContext` owns transient selection, hover, focus, active tool/view and draft
state. Workspace changes never enter persistence, snapshot hashes or analysis input.

`StructuralDocumentBridge` projects document changes into `StructuralSceneDB`. The
bridge converts Z-up document coordinates to Three.js Y-up and uses incremental SoA
add/update/delete APIs. The render database and Object3D graph are projections, not
model authorities.

Analysis receives a deeply frozen `AnalysisSnapshot` containing the source revision,
semantic hash and versioned transport model. A result is discarded when the document
revision changes before the request completes.

## Legacy migration boundary

The existing MobX/Three.js entities remain editable during Goal 12. The
`legacyModelToDocumentSeed` adapter reconciles those entities into the document. New
domain behavior must target `StructuralDocument`; Goal 13 will route mutations through
the Command Gateway and remove direct array mutation progressively.

Removal checklist for the legacy adapter:

- all node/member/shell/material/section/load/support UI mutations use commands;
- generators and MCP tools use commands and local transaction references;
- import creates document records without constructing legacy entities first;
- selection/focus reads `WorkspaceContext` only;
- renderer and analysis have no reads from legacy object arrays;
- parity tests cover open, edit, analyze, export and reload;
- delete `legacyModelToDocumentSeed` and the duplicate entity arrays only after all
  checks above pass.

## Persistence and migration

Canonical snapshots include `documentVersion`, `schemaVersion` and `revision`.
Collections and object keys are canonicalized before hashing. `fromSnapshot` rejects
unknown versions; future versions require an explicit migration before restore.

## Consequences

- Invalid reconciliation is atomic and emits no change event.
- Cascading node/section deletion removes dependent topology and target references in
  one revision.
- A single node move dirties only that node and its connected render members.
- 100,000 members can exist in the core without DOM, WebGL or Object3D allocation.
- During migration, legacy UI edits become authoritative only after reconciliation;
  command-only ownership is intentionally deferred to Goal 13.
