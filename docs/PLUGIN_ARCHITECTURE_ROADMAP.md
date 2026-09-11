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
| 3. Viewport interaction API | Planned | Host-owned pick, snap and draw sessions |
| 4. Sandboxed runtime | Planned | Manifest lifecycle, Worker/iframe RPC and crash recovery |
| 5. SDK and persistence | Planned | SDK, CLI/test harness, project storage and sample plugins |
| 6. External beta hardening | Planned | Integrity, CSP, permission UX, telemetry, revocation and threat tests |

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
