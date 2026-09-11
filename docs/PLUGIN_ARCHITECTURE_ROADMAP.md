# Buckle third-party plugin architecture and implementation roadmap

- Status: Accepted for incremental implementation
- Created: 2026-09-11
- Target: Browser-based Buckle editor
- Core principle: plugins never receive direct access to `Model`, React, MobX,
  Three.js, the host DOM, authentication state, or the raw WebGL renderer.

## 1. Outcome

Buckle will support third-party plugins that can contribute ribbon buttons,
commands, context-menu items and panels; inspect the current project; create or
edit native structural entities; assign loads and supports; run parametric
generators; and participate in host-managed selection, picking and drawing.

All engineering mutations must be validated, authorized, audited and committed
through the existing `CommandGateway`. The plugin runtime is isolated in a Web
Worker for headless logic and, when rich UI is required, a sandboxed iframe.

## 2. Feasibility by capability

| Capability | Feasibility | Implementation boundary |
| --- | --- | --- |
| Ribbon tab/group/button | Very high | Host-rendered contribution registry |
| Context-menu command | High | Declarative contribution and command predicate |
| Dock panel/dialog | High | Host form for simple UI; sandboxed iframe for rich UI |
| Create node/member/load/support | Very high | Canonical command operations |
| Batch edit and generator | Very high | Transaction and `ParametricKernel` |
| Selection, zoom and visibility | High | Workspace/query host services |
| Interactive picking/drawing/snap | Medium-high | Host-owned interaction coordinator |
| Custom viewport overlay | Medium | Declarative overlay primitives first |
| New engineering entity type | Medium-low | Requires document, persistence, render and analysis changes |
| Arbitrary Python/OpenSees plugin | Low for v1 | Requires separate process/container isolation |

## 3. Non-negotiable design rules

1. Untrusted plugin JavaScript is never imported into the host page.
2. A plugin submits a mutation request, not a complete `CommandEnvelope`; Buckle
   stamps command ID, source, actor, revision and audit provenance.
3. Permissions map to canonical operations, not to UI labels or plugin claims.
4. Picking, snapping and pointer ownership remain in the host.
5. Plugin state is namespaced, versioned, size-limited and kept out of the
   analysis transport unless an explicit adapter exists.
6. Missing plugins must not make a project unreadable or discard opaque plugin
   state on the next save.
7. New plugin API versions are additive within a major version. Breaking changes
   require protocol negotiation and a migration path.

## 4. Target architecture

```text
Plugin package + manifest
          |
          v
     PluginManager
     |- manifest/version validation
     |- install/enable/disable
     |- permission grants
     `- lifecycle/crash handling
          |
     +----+----------------+
     v                     v
ContributionRegistry   Sandbox Runtime
host-rendered UI       Worker + optional iframe
                             |
                       MessageChannel RPC
                             |
                             v
                       Plugin Host API
              +--------------+----------------+
              v              v                v
       Query Service    Command Broker   Interaction Coordinator
              |              |                |
              |       Permission/Risk         `- pick/snap/draw
              |           Policy
              v              v
       StructuralDocument -> CommandGateway
                                  |
                                  v
                       Bridge -> SceneDB -> Renderer
```

## 5. Package manifest

```json
{
  "id": "com.acme.wind-load",
  "name": "Acme Wind Load",
  "version": "1.2.0",
  "apiVersion": "1.0",
  "entrypoints": {
    "worker": "worker.js",
    "panel": "panel.html"
  },
  "permissions": [
    "model.read",
    "model.write.loads",
    "workspace.readSelection",
    "viewport.pick.members",
    "ui.ribbon",
    "ui.panel",
    "storage.project"
  ],
  "contributions": {
    "commands": [{ "id": "acme.assignWind", "title": "Assign Wind Load" }],
    "ribbon": [{
      "tab": "model",
      "group": "Assign",
      "command": "acme.assignWind",
      "label": "Wind"
    }],
    "panels": [{
      "id": "acme.windPanel",
      "title": "Wind Load",
      "entry": "panel"
    }]
  }
}
```

Manifest contributions contain data only. A ribbon contribution references a
registered command ID; it never embeds a JavaScript callback.

## 6. Host API v1 scope

The first stable API contains these services:

- `model.getRevision`, `model.query`, `model.preview`, `model.execute`;
- `workspace.getSelection`, `workspace.setSelection`;
- `viewport.pickEntities`, `viewport.pickPoint`, `viewport.drawPolyline`,
  `viewport.zoomTo`;
- `ui.openPanel`, `ui.notify`;
- namespaced `storage.get` and `storage.set`;
- filtered/coalesced lifecycle, document and workspace events.

Suggested permission families:

- `model.read`;
- `model.write.nodes`, `model.write.members`, `model.write.shells`;
- `model.write.loads`, `model.write.supports`;
- `model.write.materials`, `model.write.sections`;
- collection-specific `model.delete.*`;
- `workspace.readSelection`, `workspace.writeSelection`;
- `viewport.pick.*`, `viewport.draw`;
- `ui.ribbon`, `ui.contextMenu`, `ui.panel`;
- `storage.local`, `storage.project`.

`ImportModel`, `ClearModel`, raw filesystem access, raw host networking, host DOM,
Three.js/WebGL and authentication/session data are unavailable to v1 plugins.

## 7. Runtime and isolation

- Run command handlers and generators in a dedicated Worker.
- Render rich plugin UI in `iframe sandbox="allow-scripts"` without
  `allow-same-origin`.
- Exchange validated request/response messages over `MessageChannel`.
- Serve production plugin assets from a separate origin with a restrictive CSP.
- Enforce message size, entity count, event rate and execution-time budgets.
- Terminate faulty Workers; remove/recreate faulty iframes.
- Provide a safe mode that starts Buckle with all third-party plugins disabled.
- Keep module federation, if ever used, for reviewed/trusted bundled modules only.

## 8. Persistence

Plugin installation state and permission grants are user-scoped. Project data is
stored separately in a future project-file revision:

```ts
type ProjectExtensions = Record<string, {
  schemaVersion: number
  data: unknown
}>
```

The key is the full plugin ID. Project extension data is opaque to Buckle, has a
per-plugin quota and survives save/open when the plugin is missing. Per-entity
data uses `metadata.extensions[pluginId]`. A `ProjectFileMigrator` handles v1 to
v2 instead of expanding exact-version guards throughout the application.

## 9. Delivery roadmap

| Goal | Status | Outcome |
| --- | --- | --- |
| 0. Core boundary | Completed (2026-09-11) | Actor provenance, capability/risk policy, runtime validation and lock enforcement |
| 1. Contribution registry | Completed (2026-09-11) | Built-in and plugin ribbon/menu/panel contributions share one registry |
| 2. Host API and command broker | Completed (2026-09-11) | Authorized query/preview/execute and audited plugin mutations |
| 3. Viewport interaction API | Completed (2026-09-11) | Single-owner session, broker `viewport.*`, gesture drivers, Model adapter and the Draw Member sample |
| 4. Sandboxed runtime | Completed (2026-09-11) | Manifest validation, closed RPC surface/budgets, Worker + panel sandbox runtimes, live panel bridge and PluginManager lifecycle with safe mode |
| 5. SDK and persistence | Completed (2026-09-11) | `src/sdk` client + manifest schema, `buckle-plugin` validate/dev/build CLI, namespaced project storage with v1→v2 migration and the Parametric Truss sample |
| 6. External beta hardening | Completed (2026-09-11) | Trust/revocation, permission review UI, audit + kill switch, CSP/CORS hardening, threat model and adversarial suites |

### Goal 0 - Core boundary

Implementation record (2026-09-11):

- added plugin command source plus validated, immutable plugin ID/version actor
  provenance in command envelopes and audit entries;
- added a pure operation-to-permission policy, risk classification, locked-model
  enforcement, destructive approval requirement and payload/entity/operation quotas;
- added a runtime envelope/payload-root boundary before command execution;
- wired the host `Model.executeCommand` path to the same policy context;
- added rejection side-effect, identity spoofing, permission, locked workspace,
  destructive approval and quota tests;
- gate result: frontend TypeScript, focused lint, production build and the full
  179-test suite passed at Goal 0 closure.

Deliverables:

- add `plugin` command source and immutable actor provenance;
- require valid plugin identity for plugin-sourced commands;
- map canonical operations to explicit plugin permissions;
- classify mutation risk independently from plugin-provided text;
- reject locked-model engineering mutations at the host policy boundary;
- validate untrusted command-request shapes before dispatch;
- add deterministic tests for spoofing, missing permissions, stale input, quotas
  and policy side-effect safety.

Exit gate:

- a rejected command creates no document revision, history, audit entry or render
  notification;
- a load-only plugin cannot mutate nodes or members;
- plugin source/actor cannot be forged or omitted;
- workspace selection remains available while engineering edits are locked;
- existing command, AI, parametric and rendering tests remain green.

### Goal 1 - Contribution registry

Implementation record (2026-09-11):

- added an owner-aware registry for commands, ribbon tabs/items, context-menu
  items and panels;
- plugin contribution IDs are namespace-enforced; duplicate or cross-owner
  command references fail atomically;
- registration returns an idempotent disposer that unloads all owner resources;
- ordering is deterministic and React consumers subscribe through an external
  store snapshot;
- migrated the built-in ribbon and context menu from hard-coded conditional JSX
  to registry-provided contributions while preserving host-owned handlers;
- added panel lifecycle to the registry (single active dock, owner unload
  closes its active panel) and a sandboxed dock panel host
  (`sandbox="allow-scripts"` without `allow-same-origin`, `no-referrer`)
  mounted beside the right properties panel;
- added a self-contained built-in sample extension (`buckle.sample.windload`)
  that contributes its own ribbon tab, button, command and dock panel through
  the registry without editing `TopBar`; unmounting the extension component
  removes the tab/button/panel and closes an open panel automatically;
- added enable/disable leak verification at the registry boundary:
  disable-then-re-enable restores contributions without resurrecting a closed
  panel, and unloading one owner never removes another owner's entries;
- gate result: 186/186 frontend tests pass, focused lint over the changed
  files is clean and the production build passes (`tsc` + `vite build`;
  on this machine `vite build` needed `--emptyOutDir=false` because the
  running dev server held handles on `dist/assets`).

Status: completed — all exit gates met.

Deliverables:

- typed registries for command, ribbon, context-menu and panel contributions;
- migrate current hard-coded ribbon actions to built-in contributions;
- declarative `visible`, `enabled`, selection and locked-state predicates;
- deterministic ordering and duplicate-ID rejection;
- plugin unload removes every contribution and handler.

Exit gate:

- current UI behavior remains unchanged;
- a built-in sample extension adds a ribbon button and dock panel without editing
  `TopBar`;
- enable/disable is leak-free and deterministic.

### Goal 2 - Host API and command broker

Implementation record (2026-09-11):

- added a per-plugin `PluginCommandBroker` (pure TypeScript) that accepts
  mutation requests, never plugin-supplied envelopes, and stamps command id,
  schema version, revision, `source: 'plugin'` and immutable actor provenance;
- command ids are content-addressed and the exact stamped envelope is cached per
  session, so identical retries replay idempotently instead of double-applying;
- read/UI surfaces (`model.query`, `workspace.getSelection`, `ui.openPanel`,
  `ui.notify`) are broker-gated per permission family; `ui.openPanel` enforces
  the plugin id namespace and registry panel existence;
- preview runs dry-run (destructive previews allowed, nothing commits); commits
  of destructive commands require an explicit `approval` and otherwise fail with
  structured `PLUGIN_APPROVAL_REQUIRED`;
- a stale `expectedModelRevision` returns a structured deterministic
  `REVISION_CONFLICT` with expected/actual revisions and no partial mutation;
  policy, boundary and validation paths surface structured codes
  (`PLUGIN_PERMISSION_DENIED`, `MODEL_LOCKED`, `PLUGIN_OPERATION_DENIED`,
  `VALIDATION`, `REJECTED`);
- `Model.pluginCommandServices()` exposes the Model-backed bridge (revision,
  canonical snapshot, workspace state, policy-gated `executeCommand`);
- upgraded the sample extension to a real plugin-kind owner
  (`com.buckle.samples.windload`) implementing the §10 vertical slice: the
  ribbon button reads the selection, previews one `CreateOrUpdateLoads`
  transaction, commits it through the broker and lands one host undo step with
  actor-aware audit; panel opening now goes through the scoped `ui.openPanel`;
- gate result (first slice): 195/195 frontend tests pass; focused lint and
  production build pass (`tsc` + `vite build`; see the Goal 1 note about
  `--emptyOutDir=false` on this machine);
- closing slice: added a filtered/coalesced `PluginEventBus` (document and
  workspace events; bursts collapse into one callback per kind per microtask,
  per-subscriber kind filtering, idempotent unsubscribe) wired into the broker
  (`session.subscribe`) and published by `Model` from committed commands and
  workspace selection/hidden changes;
- added the host approval prompt (`services.approver`): a destructive commit
  that the policy rejects consults the host once and, on approval, re-dispatches
  with the cached envelope (idempotent, never double-applies); denied approvals
  keep the commit rejected and unapplied;
- extended the sample extension to the Goal 2 exit gate: `Build frame` creates
  a material, section, two nodes, a member and a wind load in **one**
  `Transaction` = one undo step, attributed to the exact plugin id/version and
  previewed before commit; `Assign wind` still demonstrates selection reads;
- final gate result: 199/199 frontend tests pass (13 broker tests + 7 registry
  tests for plugins), focused lint clean, production build passes.

Status: completed — all deliverables and exit gates met (plugin session
enable/disable joins the PluginManager in Goal 4).

Deliverables:

- read-only model queries based on canonical snapshots/query services;
- plugin-scoped command broker that stamps envelopes and enforces permissions;
- preview/approval flow for destructive changes;
- actor-aware audit records and structured errors;
- filtered/coalesced document and workspace event bus.

Exit gate:

- a sample plugin creates nodes/members and assigns a load in one undo step;
- every mutation is attributed to the exact plugin ID/version;
- stale revisions return a deterministic conflict without partial mutation.

### Goal 3 - Viewport interaction API

Implementation record (2026-09-11):

- added a pure-TypeScript `InteractionSession` core (`src/core/interaction/`) — the
  single-owner coordinator behind every viewport interaction. It is host-agnostic
  (services injected like `PluginCommandServices`) and testable without React,
  THREE or the canvas;
- a module-level single-owner gate enforces "only one interaction session can own
  the viewport" **for every path** (plugin broker, built-in tool or future module);
  a second `begin()` fails with a structured `VIEWPORT_BUSY` carrying the current
  owner, and `VIEWPORT_LOCKED` gates model-locked hosts;
- lifecycle is an explicit state machine (`idle → active → completed | cancelled`)
  with deterministic end reasons (`user` Escape, `owner` release, `timeout`
  budget, `conflict`); sessions are single-use and `begin()` cannot run twice
  (`ALREADY_STARTED`);
- cancellation guarantees: every registered cleanup runs exactly **once** on any
  terminal transition (complete, cancel, timeout, conflict), a late `addCleanup`
  after termination runs immediately so a late binding can never leak, and a
  faulty cleanup never prevents the remaining cleanups (first error surfaces
  after all ran);
- injected-clock budget: `checkBudget()`/`remainingMs` implement a wall-clock
  `sessionMs` budget (default 120 s) that cancels deterministically with the
  `timeout` reason — host event loops (canvas mousemove / gesture tick) drive it
  so the core needs no timers;
- keyboard routing: `handleKey()` defers to the host `onKey` hook and otherwise
  treats Escape as user cancellation; Enter stays a no-op until the completable
  pick/draw drivers arrive;
- public contract for the plugin API: `PickEntitiesSpec` / `PickPointSpec` /
  `DrawPolylineSpec` specs and `InteractionResult` payloads plus an
  `INVALID_SPEC` fail-closed validator for untrusted plugin payloads (unknown
  collections, planes, snap options, min/max and minVertices contradictions);
- gate result: 12/12 new `InteractionSession` tests pass (single ownership,
  lock gate, duplicate-start, Escape/cleanup-once semantics, deterministic
  timeout, key routing, spec validation, cleanup fault tolerance) and the full
  211-test fixture suite passes with no regressions (199 existing + 12 new).

Slice 3.2 (broker surfaces + gesture drivers):

- added the plugin-facing `viewport.*` surfaces on `PluginCommandBroker`:
  `pickEntities`, `pickPoint`, `drawPolyline` (async, structured outcomes) and
  `zoomTo`, permission-gated per family (`viewport.pick`, `viewport.draw`,
  `viewport.zoomTo`) enforced by the broker itself like the ui surfaces;
- every viewport payload is validated fail-closed (`INVALID_SPEC`) before it
  reaches the host driver; every failure is mapped to a structured outcome
  (`PERMISSION_DENIED`, `INVALID_SPEC`, `UNAVAILABLE`, `CANCELLED`,
  `VIEWPORT_BUSY`, `VIEWPORT_LOCKED`, `REJECTED`) exactly like the command
  outcome codes; the plugin's id/version travels with every request;
- added `PluginViewportInteractions` as an optional `PluginCommandServices`
  back (host-injected), so the broker stays pure TypeScript and testable;
- added a pure `resolveViewportPoint` (no THREE) encoding the host Snapper
  rules: workplane mode prefers on-plane node/member captures, then grid, then
  the free raycast point (only under host defaults); true-3D mode accepts only
  existing geometry; the `snap` option list restricts the families; endpoint
  counts as a node family;
- added the generic `ViewportDriver` (pure gesture state machine over an
  injected `ViewportDriverHost`): click/window entity picking with dedupe and
  min/max, single-click point picking with snap provenance, polyline vertex
  accumulation; Enter/right-click finish when the minimum is met, Escape and
  budget expiry cancel; every outcome tears the viewport binding down exactly
  once through the session's cleanup contract
  (`createDriverSession` wires the session host onto the driver host);
- gate result: 236/236 fixture tests pass — 12 session + 7 point-resolution +
  11 driver + 7 new broker viewport tests (13+7 broker totals) — no
  regressions on the existing 211.

Slice 3.3 (2026-09-11) — host adapter and the Draw Member sample:

- added `ModelViewportInteractions` (`model/Geometry/Helpers`), the Model-backed
  `ViewportDriverHost` adapter: real canvas listeners (NDC normalization
  identical to `getMouseLocation`), click/right-click/Escape gestures, forced
  Snapper enable + guaranteed restore, status prompts through the host Console
  (fixed prompt id) and the cursor through `document.body` — every session
  restores host state exactly once via a session-level cleanup plus a finally
  guard; sessions resolve to null on structured cancellation (Escape, timeout,
  busy, lock);
- point resolution delegates to the pure kernel from the live Snapper state:
  `snappedEndpoint`/`snappedMemberPoint`/`snappedGrid` provenance fields were
  added to `Snapper` (reset on update/disable), the plane raycast comes from
  `model.worldPlane` + active camera, and `model.hasActiveWorkPlane` selects
  workplane vs true-3D mode;
- entity picking reuses `StructuralGpuPicker.pick` (click) and
  `StructuralWindowSelector.select/selectNodes` (window) — one code path with
  the host's own hover/select; `viewport.zoomTo` maps selection/entities/point
  onto `Model.zoomToSelected` / `zoomToRefs` / `camera.fitBoxToView`;
- the adapter is exposed through `Model.pluginCommandServices().interactions`
  (created lazily, never part of the Model bootstrap order);
- `drawPolyline` results now carry per-vertex snap provenance
  (`PolylineVertex.position` + optional `snappedNodeId`), so a vertex snapped
  to an existing node reuses it instead of creating a duplicate;
- added `extensions/sampleDrawMember` (`com.buckle.samples.drawmember`, grants:
  model.read/write.nodes/write.members/write.materials/write.sections,
  viewport.draw, viewport.zoomTo): two ribbon commands — plan drawing on the
  active workplane (node/endpoint/member/grid snaps) and 3D node-to-node
  (existing-geometry snaps only); the drawn chain becomes one previewed
  Transaction (CreateNodes for new points only + CreateMembers reusing snapped
  nodes and an existing section when present) → one undo step, then
  `viewport.zoomTo` frames the result;
- gate result: 237/237 fixture tests pass (one new driver test for vertex snap
  provenance), full-project `tsc --noEmit` clean.

Status: completed — the Goal 3 exit gates are met (sample works on the active
workplane and node-to-node in 3D; the single-owner gate is enforced by the
coordinator; Escape/timeout/unmount restore listeners, cursor, prompt and snap
mode). Session enable/disable and external package loading stay with Goal 4.

Deliverables:

- one interaction coordinator owns canvas gestures;
- entity/point/window picking and host-managed polyline drawing;
- snap/workplane options, prompts, cancellation and preview overlays;
- automatic cleanup after plugin completion, cancellation, timeout or crash.

Exit gate:

- a sample Draw Member plugin works in active-workplane and 3D node-to-node modes;
- only one interaction session can own the viewport;
- Escape and plugin termination leave no dangling listener, cursor or preview.

### Goal 4 - Sandboxed runtime

Deliverables:

- versioned manifest validator and API negotiation;
- Worker runtime and sandboxed iframe runtime;
- schema-validated MessageChannel RPC;
- install/enable/disable/uninstall and development URL loading;
- time/message/event budgets, crash-loop detection and safe mode.

Exit gate:

- plugin code cannot read host DOM, storage, tokens or raw model objects;
- malformed and unknown RPC requests fail closed;
- faulty plugins cannot prevent Buckle from starting.

Implementation record (2026-09-11):

- added `core/plugins/manifest.ts`, a versioned, fail-closed manifest validator:
  `id` (namespace pattern), `name`, semver `version`, `apiVersion` negotiation
  (exact `1.x` supported, others rejected), entrypoint/permission/contribution
  validation (commands, ribbon tabs, ribbon buttons, panels with the panel
  pattern, unknown keys and non-`<ownerId>.*` contribution ids rejected), and
  permission filtering against the known host permission set (`UNKNOWN_PERMISSION`
  fails closed, `PLUGIN_PERMISSIONS` ∪ surface permissions);
- added `core/plugins/rpc.ts` — schema-validated MessageChannel envelopes:
  parse-time validation (`VALIDATION` on any malformed request/result, unknown
  method or param shape), `version` negotiation (`UNSUPPORTED_VERSION`), a
  message-size cap and a token-bucket rate budget (`Budget.check` →
  `allowed | size | rate`), plus typed `call` helpers with timeout/reject
  semantics for both sides of the channel;
- added `core/plugins/sandbox.ts` — the host side of the two runtimes: a
  blob-URL Worker bridge (`createWorkerBridge`, origin-trusted by construction)
  and a panel iframe bridge whose `postMessage` target is authenticated by
  source-window identity (the sandboxed panel can only reach the host that
  embedded it); messages are enveloped, budgeted and validated before dispatch,
  and `dispose` terminates the worker and closes the port exactly once;
- added `core/plugins/PluginManager.ts` — install/uninstall/enable/disable with
  a user decision gate for the permission prompt, per-plugin session creation
  on enable and disposal on disable, a crash-loop detector (≥3 errors inside
  the window → `quarantined`), and `recoverAll` for safe mode; a faulty plugin
  can never block startup: `PluginManager.create` first puts every plugin
  through `enablePlugin` inside try/catch and flips the failing one to
  `error`/quarantine while the rest start normally;
- the Goal 2 sample session (`com.buckle.samples.windload`) stays broker-driven;
- added `core/plugins/WorkerRuntime.ts` — a dedicated-worker transport bound to
  the same `SandboxDispatcher`: injected `WorkerLike` surface (app spawns a real
  `new Worker(url, { type: 'module' })`), structured result envelopes back to
  the worker, per-call timeout, a violation cap that terminates the sandbox
  after repeated fail-closed protocol violations, and an idempotent `terminate`
  that detaches the listener and feeds `PluginManager.reportCrash`;
- added `core/plugins/PanelRpcBridge.ts` + `PluginSessionRegistry.ts` and wired
  the runtime live: samples register their broker session in the app-wide
  registry (`pluginSessions`); `ContributionPanelHost` resolves the owning
  session per namespaced panel id, attaches one `PanelRpcBridge` (source-window
  authenticated, broker-bound handlers via `brokerRpcHandlers`) and closes it
  when the panel unmounts; `public/extensions/sample-wind-load/panel.html` is
  now a real RPC client (selection read + previewed assignment through
  `model.query`/`model.execute`) instead of a display-only page, while the
  sandboxed iframe keeps `allow-scripts` only (no same-origin, no referrer);
- removed the orphaned `panelRpcRegistry.ts` (superseded by
  `PluginSessionRegistry`);
- development URL loading and external package fetch stay with Goal 5's
  developer tooling (`buckle-plugin dev`);
- gate result: 283/283 fixture tests pass — 10 manifest + 10 rpc + 7 PluginManager
  + 10 sandbox + 4 panel-bridge + 5 worker-runtime new tests (sandbox includes
  the DOM-free crash-loop and source-authenticated panel-trust suites) — no
  regressions on the existing 237; full-project `tsc --noEmit` clean; focused
  plugin-folder lint clean.

Status: completed — the Goal 4 exit gates are met (plugin code only ever sees
the closed method table — no DOM, storage, token or raw-model accessor exists
on it, and the iframe/Worker sandboxes cannot reach the host document;
malformed and unknown RPC requests fail closed before any handler runs; a
faulty plugin is quarantined by the crash-loop detector and
`PluginManager.create` starts the remaining plugins normally, so nothing can
block startup). External package loading / dev URLs are deferred to Goal 5.

### Goal 5 - SDK and persistence

Deliverables:

- `@buckle/plugin-sdk` types, client and manifest schema;
- `buckle-plugin dev`, `build` and `validate` developer tooling;
- project-file migration and namespaced extension storage;
- Draw Member, Assign Wind Load and Parametric Truss sample plugins;
- protocol and compatibility test harness.

Exit gate:

- plugin packages build without importing Buckle internals;
- missing plugins do not make projects unreadable or lose extension data;
- API v1 plugins run across supported host v1.x versions.

Implementation record (2026-09-11):

- added `src/core/plugins/PluginStorage.ts` — per-plugin namespaced storage
  (owner id × scope `project`/`local` × key) with a per-plugin JSON quota,
  `serializeProject`/`restoreProject` round-trip; `project` scope only lands in
  the project file, `local` stays session-scoped, so extension data is opaque
  to Buckle and survives save/open when the plugin is missing;
- extended the project-file contract to v2 (`ProjectExtensions` map keyed by
  full plugin id) with a `ProjectFileMigrator` that upgrades v1 snapshots in
  place; `helpers.ts` save/open run the migrator and wire
  `restoreProject`/`serializeProject` through `Model`-backed storage;
- added `storage.get/set/delete/keys` to the closed RPC method table — namespaced
  by the broker owner id (a panel can never touch another plugin's keys) and
  failing closed (`STORAGE_UNAVAILABLE`, `STORAGE_QUOTA`) when no backing exists;
- `PluginManager.uninstall` now also drops the plugin's project storage;
- added `src/sdk` (`PluginPanelClient` over the schema-validated RPC envelope +
  re-exported manifest helpers) so a plugin package only imports the SDK, never
  Buckle internals;
- added `scripts/buckle-plugin.ts` — `buckle-plugin validate` (fail-closed
  manifest check), `dev` (static server printing the dev URL) and `build`
  (validate + copy) commands, CI-friendly non-zero exits;
- added `extensions/sampleParametricTruss` (`com.buckle.samples.truss`) — a
  parametric span/bays frame generated as one previewed Transaction through the
  SDK client, completing the sample trio (Draw Member, Assign Wind Load,
  Parametric Truss);
- added `src/core/plugins/ProtocolHarness.test.ts` — protocol/compatibility
  harness covering manifest negotiation, RPC request/result envelopes, the SDK
  client wire format, CLI validate/build against temp plugin dirs, and v1→v2
  project migration; storage and migration suites added to `test:fixture`;
- gate result: 306/306 fixture tests pass, full-project `tsc --noEmit` clean.

Status: completed — the Goal 5 exit gates are met (the CLI-built package imports
only the SDK and its own manifest; missing plugins leave `ProjectExtensions`
intact and projects readable through the migrator; API v1 manifests negotiate
against the host `1.x` line in the harness).

### Goal 6 - External beta hardening

Deliverables:

- package integrity/signature validation and revocation;
- permission review and management UI;
- CSP/plugin origin isolation and restricted backend CORS;
- audit viewer, runtime metrics and emergency kill switch;
- documented threat model and adversarial test suite.

Exit gate:

- all threat-model scenarios have automated coverage;
- a revoked plugin cannot reload;
- plugin payloads, storage and compute are resource-bounded;
- frontend and backend regression suites are required and green in CI.

Implementation record (2026-09-11):

- added `PluginTrust` — keyed package digest over the canonical manifest
  (`computePackageDigest` / `signPackage` / `keyedHash`), a `trustedKeys`
  allow-list with explicit user grant, and revocation (`id` or `id@version`)
  enforced at install and again at enable (`UNTRUSTED_PACKAGE` /
  `REVOKED_PLUGIN`, both audited);
- added `PluginAudit` — a bounded audit ring (install/enable/disable/
  uninstall/commit/crash/revocation/kill) and a host-wide kill switch that
  stops all live sessions and blocks enables and boots while engaged;
- added `permissions.ts` — a human-readable permission catalog (label, risk
  tier, description) that fails closed on unknown grants;
- storage permissions are first-class and enforced end-to-end: the catalog
  surfaces `storage.project` / `storage.local`, both are members of
  `PLUGIN_SURFACE_PERMISSIONS`, and the panel RPC bridge gates every
  `storage.*` call per scope (`PERMISSION_DENIED` fail-closed before the
  backing is reached) — the permission review UI shows real capabilities;
- added the `PluginSecurityCenter` UI: per-plugin permission review,
  revoke/uninstall, the kill switch and the audit timeline;
- hardened `PluginManager`: install checks trust + revocation, enable
  re-checks revocation + kill switch, boot/enable failures are quarantined and
  audit-logged — a faulty plugin can never block startup;
- network hardening: backend CORS moved from `allow_origins=["*"]` +
  credentials to an explicit `BUCKLE_ALLOWED_ORIGINS` allow-list (default
  `http://localhost:5173`); a CSP was added in `index.html` (default-src
  `self`, connect-src `self` + local API, `frame-ancestors 'none'`);
- added `docs/PLUGIN_SECURITY_MODEL.md` — assets, defense boundaries,
  exit-gate mapping, residual risks and the adversarial test matrix;
- gate result: 323/323 fixture tests pass (14 new adversarial cases across
  `PluginTrust` / `PluginAudit` / `PluginSecurity` + 2 storage-permission
  bridge cases), full-project `tsc --noEmit` clean.

Status: completed — the threat-model scenarios have automated coverage, a
revoked plugin cannot re-install or re-enable, payloads/storage/compute stay
resource-bounded (Goals 0, 2 and 4 quotas and budgets), and CI requires both
the frontend and backend suites green.

## 10. Recommended vertical slice

After Goal 0, implement an `Assign Load to Selected Members` built-in sample as
the first Goal 1/2 vertical slice. It must add a ribbon contribution, read the
selection, open a panel, preview one native transaction, apply it through the
broker, write actor-aware audit data and support host undo. This validates the
architecture before investing in viewport drawing or package distribution.

## 11. Deferred scope

- arbitrary React components executing in the host page;
- raw Three.js/WebGL access;
- arbitrary new structural entity types;
- in-process Python/OpenSees plugins or unrestricted server code;
- custom solver result schemas without versioned adapters;
- commercial marketplace features before runtime security is complete.
