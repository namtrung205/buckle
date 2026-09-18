# Public plugin SDK: implementation goals

Status: implementing · 2026-09-14

Current user priority: deliver a usable third-party authoring workflow and
local ZIP installation. The remaining P5 public-security release gates are
deferred for now; they do not block the local SDK guide, sample or conformance
work. Publishing an npm package remains a separate P7 decision.

Implementation progress (2026-09-14):

| Goal | State | Evidence / remaining work |
| --- | --- | --- |
| P0 | Alpha contract | Shared package contract, host imports the same manifest validator and bundle parser, `API_V1.md` documents the alpha surface. Typed parameter/result schemas and full contract conformance remain. |
| P1 | Alpha usable | `@buckle/plugin-sdk` packs with ESM/types, Worker/panel client and external-project type check. Canonical model mutation types need a public typed builder. |
| P2 | Alpha usable for declared commands | Worker readiness and command invocation route ribbon/context-menu commands to SDK handlers with timeout and teardown tests. Worker errors disable and eventually quarantine the plugin. Invocation payload limits and complete UI error reporting remain. |
| P3 | Complete for local ZIPs | Public CLI `init/validate/build` emits a deterministic ZIP; external tarball smoke test builds and validates it. Remote dev URL is not offered by the public CLI. |
| P4 | Functional exit gate met | Manage plugins reviews permissions, stores ZIPs in IndexedDB, restores enabled plugins individually, and offers disable/enable/update/uninstall. Worker failures disable the plugin; three failures quarantine it until manual release. The legacy manifest-only `PluginManager` still needs to be unified with this live ZIP path; publisher metadata remains. |
| P5 | In progress | ZIP limits, opaque Worker/panel isolation, whole-ZIP SHA-256 pinning and optional Ed25519 signatures are wired into install/restore/enable. The first signed install pins its public key for updates; a local key blocklist stops matching plugins. Edge browser fixtures confirm RPC, blocked network access and Ed25519 verification. Independent publisher-key distribution, authenticated remote revocation, browser matrix and adversarial resource/navigation tests remain release gates. See `PLUGIN_SECURITY_BOUNDARY.md`. |
| P6 | Local-alpha workflow complete | Vietnamese create/build/install guide, SDK-based Worker+panel starter, SDK-based Hello Buckle sample ZIP, and `test:external` pack/install/type-check/build/install/command/reload lifecycle conformance pass. Full host/version compatibility matrix remains for a public release. |
| P7 | Local artifact ready | `frontend/releases/buckle-plugin-sdk-0.1.0-alpha.1.tgz` is available for direct partner testing. It is not published to npm; license and public release policy remain open. |

This plan covers a third-party author who does **not** have the Buckle source
tree: install a public SDK, build a plugin ZIP, give that ZIP to a Buckle user,
and have it load and run through **File → Manage plugins**. It is a release plan
separate from the internal architecture milestones in
`PLUGIN_ARCHITECTURE_ROADMAP.md`.

## Target workflow after publication

```text
npm exec --package=@buckle/plugin-sdk -- buckle-plugin init my-plugin
cd my-plugin
npm install
npm run build                 # dist/my-plugin-1.0.0.zip
```

The user selects the ZIP in Buckle, reviews the manifest and permissions, and
installs it. A contributed ribbon button invokes the plugin's own handler;
unloading the plugin removes its Worker, panel, commands and ribbon entries.

The first public format is a local ZIP with `buckle.plugin.json` at its root.
Single-file JS remains a developer convenience, not the distribution format.
Marketplace, remote development URLs, native/Python plugins, arbitrary host DOM
access and new engineering entity types are outside this plan.

## Baseline before this implementation (historical)

- `frontend/src/sdk` contains an internal client, but no standalone published
  package or package export. Its hand-maintained permission type differs from
  the host permission catalog.
- `frontend/scripts/buckle-plugin.ts` validates a manifest and copies a folder;
  `build` does not compile Worker/panel source or emit an installable ZIP. Its
  `dev` URL is not accepted by the current local file loader.
- `frontend/src/core/plugins/PluginBundleLoader.ts` maps every declared command
  to opening the first panel (or a notification); it cannot invoke a plugin
  command handler in the Worker.
- The current loader is session-only and launches directly. The trust and
  lifecycle logic in `PluginManager` is not yet the install path used by the UI.
- `frontend/examples/hello-plugin` proves ZIP loading but manually implements
  RPC and does not consume a separately installed SDK.

## Goal P0 — Freeze one API v1 contract

**Depends on:** none. **Scope:** definitions and compatibility rules, no UI.

- [ ] Define a single source of truth for manifest schema, permission names,
  RPC method/parameter/result types and API-version negotiation. Host and SDK
  must derive from it; delete the SDK's duplicated permission union.
- [ ] Specify lifecycle and command-invocation messages separately from
  plugin-to-host RPC. Document error codes, timeouts and cancellation.
- [ ] Decide which existing host APIs are actually callable in v1. Any method
  listed publicly must have a working host bridge and permission enforcement.
- [ ] Document compatibility: v1 additions are non-breaking; breaking changes
  require v2 and an explicit host version gate.

**Deliverable:** versioned API reference plus contract tests that fail if SDK
and host catalogs/schema diverge. **Exit gate:** every permission and method
exported by the SDK is accepted by the host, and every host-exposed method is
documented with its grant and payload shape.

## Goal P1 — Publishable SDK package

**Depends on:** P0. **Scope:** author-facing library, not plugin installation.

- [ ] Move or package `frontend/src/sdk` as an independently buildable
  `@buckle/plugin-sdk` with `exports`, ESM output, `.d.ts` files and an explicit
  supported Node/browser matrix. No runtime import from Buckle app internals.
- [ ] Provide typed Worker and panel clients using the same v1 envelopes:
  `query`, `execute`, `notify`, `openPanel`, namespaced storage and error types.
- [ ] Provide a Worker-side entrypoint helper for initialization, command
  registration and cleanup. Ensure `dispose()` detaches listeners and rejects
  pending calls.
- [ ] Test the package with `npm pack` and a temporary project outside this
  repository; compile that project without path aliases or Buckle source files.

**Deliverable:** installable package tarball. **Exit gate:** the external test
project imports only `@buckle/plugin-sdk`, type-checks and exchanges a v1 RPC
message with the host protocol harness.

## Goal P2 — Execute plugin-owned commands

**Depends on:** P0–P1. **Scope:** runtime behavior of declared contributions.

- [ ] Add host → Worker `command.invoke` request/reply with command ID,
  invocation ID, bounded payload, timeout and structured failure.
- [ ] Let the SDK register a handler for each command declared in the manifest.
  Reject missing, duplicate or cross-plugin handlers before contributions
  become active.
- [ ] Route ribbon/context-menu contribution clicks to the owning handler.
  Keep `ui.openPanel` an explicit action; do not automatically open the first
  panel for every command.
- [ ] On disable, crash or kill switch, cancel in-flight invocations and remove
  all handlers/contributions. A failed activation must roll back completely.

**Deliverable:** end-to-end test plugin whose ribbon button changes its own
state, queries the model and reports a result. **Exit gate:** click invokes
exactly its registered Worker handler once; failures surface to the user; unload
leaves no callable command or open panel.

## Goal P3 — One-command, reproducible ZIP build

**Depends on:** P0–P2. **Scope:** author CLI and bundle format.

- [ ] Add `buckle-plugin init`, `validate` and `build` to the public package's
  CLI. `init` creates a self-contained TypeScript starter project.
- [ ] `build` compiles Worker imports into a single `.js`/`.mjs`, embeds panel
  scripts/styles into self-contained HTML, writes the manifest at ZIP root and
  emits `dist/<id>-<version>.zip` with deterministic file ordering.
- [ ] Validate the final ZIP with the **same parser and limits** as Buckle's
  installer (entrypoints, paths, extensions, file count, compressed and
  expanded sizes, API version and permissions). Do not report success after
  merely copying source files.
- [ ] Make `dev` either produce a watch-mode ZIP accepted by the local loader,
  or remove its advertised remote-URL workflow until host support exists.

**Deliverable:** CLI-generated ZIP from an external starter project. **Exit
gate:** Buckle loads that ZIP without manual `Compress-Archive`, source imports
resolve, and two builds from identical inputs have identical contents.

**Milestone A — private alpha:** P0–P3 permit selected partners to author and
manually load working plugins. Label the SDK prerelease; do not promise public
untrusted-code support yet.

## Goal P4 — Installation and lifecycle in the app

**Depends on:** P3. **Scope:** Manage plugins and restart behavior.

- [ ] Unify the UI loader and `PluginManager` so install, enable, disable,
  update, uninstall, audit, quarantine and kill switch use one lifecycle path.
- [ ] Before activation show publisher/name, ID, version, API version and each
  requested permission. Store the user's grant decision per plugin/version;
  require review when an update adds permissions.
- [ ] Persist installed ZIPs and enabled state locally; restore after reload in
  safe mode, isolate individual boot failures and retain a way to remove a
  broken plugin before it starts.
- [ ] Define update/uninstall data policy for `storage.project` and
  `storage.local`; make it visible in the UI.

**Deliverable:** install/update/disable/uninstall flow in Manage plugins.
**Exit gate:** enabled plugins restart after reload; disabled plugins remain
installed but do not run; a broken plugin cannot prevent Buckle from opening.

## Goal P5 — Security gate for third-party ZIPs

**Depends on:** P3–P4. **Scope:** hostile or compromised packages.

- [ ] Audit actual browser isolation. A blob Worker may still have browser
  capabilities outside the host RPC table; test network and same-origin access
  explicitly. Choose a separate-origin execution boundary or document and
  restrict the trusted-local-only policy before a public release.
- [ ] Enforce ZIP limits before and during decompression, including aggregate
  expanded size and compression ratio; fuzz path/manifest/HTML edge cases.
- [ ] Decide a verifiable publisher/signature format over the **whole bundle**
  and an update/revocation policy. The existing keyed manifest digest is not a
  public signing system. Unsigned local ZIP policy must be explicit.
- [ ] Review panel CSP, message-source checks, permission enforcement, resource
  budgets, cleanup on crash and kill-switch behavior in the real install path.

**Deliverable:** threat-model update and adversarial tests. **Exit gate:** the
chosen trust policy is enforced during install and reload, tampered/revoked
bundles are rejected, and documented isolation claims match browser behavior.

## Goal P6 — Third-party documentation and conformance suite

**Depends on:** P0–P5. **Scope:** developer experience and compatibility.

- [ ] Publish quickstart, manifest reference, grants with examples, command
  payloads/results, Worker/panel lifecycle, packaging limits, compatibility
  policy and troubleshooting/error-code guide.
- [ ] Replace the hand-written RPC sample with two external projects consuming
  the installed SDK: a headless command plugin and a Worker + panel plugin.
- [ ] Add a conformance test that runs against the packed SDK and CLI, builds
  both external examples, loads the emitted ZIPs into the actual host contract,
  invokes commands, then disables/reloads/uninstalls them.
- [ ] Include Windows PowerShell and POSIX instructions; no step should require
  copying Buckle source or editing host code.

**Deliverable:** documentation site/README and runnable external fixtures.
**Exit gate:** a developer starting from a clean directory can follow the
quickstart verbatim and produce a ZIP accepted by Buckle.

## Goal P7 — Release and version maintenance

**Depends on:** P5–P6. **Scope:** public availability.

- [ ] Add CI for package build, `npm pack`, external examples, host conformance
  and the supported host/SDK version matrix.
- [ ] Publish a prerelease first, collect partner feedback and fix compatibility
  gaps before 1.0. Record changelog, deprecation window and release ownership.
- [ ] Choose and add the SDK license before public distribution; the local
  alpha tarball is marked `UNLICENSED` until that decision is made.
- [ ] Add a release gate: no SDK tag if its generated ZIP cannot install and
  run on the corresponding Buckle build.

**Deliverable:** public package and release checklist. **Exit gate:** a tagged
SDK version is installable from a clean project, its examples pass the host
matrix, and the exact artifact/version used for the release is archived.

**Milestone B — public beta:** P0–P7 complete and a prerelease published.
**Milestone C — stable 1.0:** beta feedback resolved, with the documented
compatibility and security policies enforced by the release checks.

## Implementation rule

Complete each goal's exit gate before starting work that depends on it unless
the user explicitly defers that gate, as with P5 for the local SDK workflow. Keep
the existing internal roadmap's historical status unchanged; this file tracks
the remaining work to make the plugin system usable as a **public SDK**.
