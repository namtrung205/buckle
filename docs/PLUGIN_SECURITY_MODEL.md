# Plugin Security Model

Threat model and hardening notes for the Buckle plugin system (roadmap Goals 0–6).
Read this before extending the plugin surface: every new capability must be added
**fail-closed** and listed in one of the boundaries below.

## 1. Trust model and assets

| Asset | Value | Where it lives |
|---|---|---|
| Structural model | High — the user's engineering work | `core/structural` document + command gateway |
| Model credentials / tokens | High — API keys, auth | never exposed to plugin code |
| Host DOM / user data | Medium | the app window |
| Plugin code | Untrusted by definition | manifest + entrypoints |
| Extension storage | Low–medium, per-plugin quota | `PluginStorage` (project + local scopes) |

Plugins are **untrusted code with mediated capabilities**. Nothing below relies
on plugin honesty; every capability is a host-side check.

## 2. Security boundaries (defense in depth)

1. **Manifest boundary** (`manifest.ts`) — versioned schema validation,
   unknown-key rejection, api-version negotiation (`1.x` only), namespace rule
   `contribution.id ∈ <ownerId>.*`, permission filter against the host catalog.
   Anything malformed → rejected, never executed.
2. **Command boundary** (`CommandGateway` + `CommandPolicy`) — every mutation
   is a schema-validated, revision-stamped envelope. Destructive commands
   require explicit approval. Plugin envelopes are host-stamped: plugins cannot
   forge `source`, `actor` or revisions; identical retries replay idempotently.
3. **RPC boundary** (`rpc.ts`) — schema-validated MessageChannel envelopes,
   method allow-list, size cap, token-bucket rate budget. Malformed/unknown
   requests fail closed with structured errors.
4. **Runtime boundaries** (`sandbox.ts`, `WorkerRuntime.ts`, `PanelRpcBridge.ts`)
   - **Worker**: blob-URL worker; the plugin runtime sees only the RPC port.
   - **Panel iframe**: `sandbox="allow-scripts"` (no `allow-same-origin` — the
     origin stays opaque so `localStorage`/DOM of the app is unreachable),
     `referrerPolicy="no-referrer"`, and inbound messages are accepted only
     from the embedding host window (source-identity check).
   - **Viewport interaction**: session-based, single-owner, host-owned
     snapping/picking; guaranteed cleanup on cancel/timeout/termination.
5. **Storage boundary** (`PluginStorage.ts`) — namespaced per plugin id, quota
   enforced, `project` scope persisted under the plugin's key in
   `ProjectExtensions` (opaque to the host, survives uninstall/re-install),
   `local` scope is session-only. Plugins never read another plugin's data.
6. **Trust boundary** (`PluginTrust.ts`) — keyed package digests over the
   canonical manifest, `trustedKeys` allow-list, and a revocation set
   (`id` or `id@version`) enforced at install and enable.
7. **Audit + kill switch** (`PluginAudit.ts`) — bounded ring of every
   privileged action (install/enable/commit/crash/kill/revocation) plus a
   host-wide kill switch that stops all live sessions and blocks new enables
   with one user action (`PluginSecurityCenter` UI).

## 3. What plugin code can never do (roadmap exit gates)

| Capability | Enforcement |
|---|---|
| Read host DOM | Panel iframes are origin-opaque (`sandbox` without `allow-same-origin`); Worker runtime receives only the RPC port |
| Read host storage | No `localStorage`/IndexedDB handle is ever passed across the RPC boundary; storage is mediated by `PluginStorage` with per-plugin namespaces |
| Read tokens / credentials | No host credential is part of any RPC surface; API keys stay in the host app, outside every plugin path |
| Read raw model objects | Plugins only see the frozen canonical snapshot through `model.query` and commit through schema-validated command envelopes |
| Forge identity / revision | Envelopes are host-stamped (`source: 'plugin'`, actor, revision); plugin-supplied values are overwritten |
| Attack with malformed RPC | `rpc.ts` rejects unknown methods, wrong params, oversized and over-rate messages with structured errors |
| Block app startup | `PluginManager.bootAll` isolates each boot in try/catch and quarantines crash-loops; a faulty plugin can never prevent Buckle from starting |

## 4. Trust, signatures and revocation (Goal 6)

- **Digest**: `computePackageDigest` hashes the canonical manifest JSON with a
  host key (`keyedHash`). Documented swap-in point for a real HMAC/ed25519
  when a signing service exists — the boundary contract does not change.
- **Allow-list**: `PluginTrustStore.trustedKeys` decides whether a digest is
  installable; unknown keys fail closed unless explicitly granted by the user
  (`grantKey`).
- **Revocation**: `revoke('id')` blocks the plugin at any version,
  `revoke('id@version')` blocks one release; both are checked at **install**
  and again at **enable** (a previously-installed but later-revoked package
  cannot be re-enabled).
- Bypass attempts raise `PluginTrustError` with codes
  `UNTRUSTED_PACKAGE` / `REVOKED_PLUGIN` and are audit-logged.

## 5. Network hardening

- **Backend CORS** (`backend/main.py`): the wide-open
  `allow_origins=["*"]` + `allow_credentials=True` pair (rejected by browsers,
  and which would otherwise let any site call the analysis API) was replaced
  by an explicit origin allow-list driven by `BUCKLE_ALLOWED_ORIGINS`
  (default `http://localhost:5173`, the Vite dev server).
- **Frontend CSP** (`index.html`): `default-src 'self'`; scripts/styles/imgs
  limited to `self` + inline (Vite/MUI runtime); `connect-src` restricted to
  `self` and the local API (`http://localhost:8000`); `frame-src 'self'`;
  workers allowed from `self` (blob workers are created by the host itself);
  `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'` — the app
  cannot be framed by third parties.

## 6. Residual risks (accepted, with mitigations)

| Risk | Mitigation |
|---|---|
| A trusted plugin misbehaves inside its grants | Permission review UI (`PluginSecurityCenter`) lists each grant with plain-language descriptions; the user disables the plugin or hits the host-wide kill switch in one click |
| In-process keyed hash is not cryptographic | Documented swap-in point; the digest only gates *install* — every capability stays host-mediated, so the hash is not a security boundary by itself |
| Plugin DoS via legitimate-looking calls | RPC token-bucket + size caps + Worker terminate + panel bridge dispose; time budgets on viewport interactions |
| Storage grows unbounded | Per-plugin byte quota enforced by `PluginStorage`; the project payload is bounded by the same quotas |

## 7. Adversarial test coverage

| Attack | Test |
|---|---|
| Tampered manifest after signing | `PluginTrust.test.ts` — digest mismatch → `UNTRUSTED_PACKAGE` |
| Revoked plugin re-installed / re-enabled | `PluginTrust.test.ts`, `PluginSecurity.test.ts` |
| Malformed / unknown / oversized / over-rate RPC | `rpc.test.ts` |
| Cross-owner storage access, quota breach | `PluginStorage.test.ts` |
| Crash-loop / hostile boot | `PluginManager.test.ts`, `PluginSecurity.test.ts` (boot failure cannot block startup) |
| Kill switch stops sessions and blocks enables | `PluginAudit.test.ts`, `PluginSecurity.test.ts` |
| Manifest namespace escape (`id` outside `ownerId.*`) | `manifest.test.ts` |
| Approval bypass for destructive commands | `PluginHostApi.test.ts` |

## 8. Verification gates (Goal 6)

- Security suites green in `npm run test:fixture` (`PluginTrust`,
  `PluginAudit`, `PluginSecurity`).
- CI (`.github/workflows/quality.yml`) requires **both** the frontend fixture
  suite and the backend pytest suite — a security regression cannot merge
  silently.
- CORS + CSP changes are reviewed here; any new external origin must be added
  to `BUCKLE_ALLOWED_ORIGINS` explicitly, never via `*`.

