# Buckle plugin API v1

The canonical definitions are exported from `@buckle/plugin-sdk`. Buckle's
manifest validator, permission policy and RPC parser consume the same contract
source. `apiVersion: 1` is required in `buckle.plugin.json`; unknown versions,
permissions, contribution keys and RPC methods are rejected.

## Package and lifecycle

A plugin ZIP contains `buckle.plugin.json` at its root, a bundled Worker file
for commands, and optional self-contained panel HTML files. The host validates the ZIP and
manifest before creating the Worker. For every declared command, the Worker
registers a handler with `createWorkerPlugin`. It sends
`{v:1,kind:'plugin.ready',commands:[...]}`; the host compares the IDs to the
manifest before showing any contribution. A ribbon click sends
`{v:1,kind:'command.invoke',id,commandId}`. The Worker replies with
`{v:1,kind:'command.result',id,ok:true,value?}` or
`{v:1,kind:'command.result',id,ok:false,error:{code,message}}`.

Startup readiness and each command have a five-second deadline. Disable,
unload or kill switch terminates the Worker and rejects pending invocations.
Reviewed ZIPs are stored locally and enabled plugins are restored individually
on reload. A failed ZIP is disabled without blocking the app. A Worker crash
disables its plugin; three crashes quarantine it until the user releases it in
Manage plugins.

## Worker-to-host methods

RPC requests use `{v:1,id,method,params?}`. Replies use
`{v:1,id,ok:true,value}` or `{v:1,id,ok:false,error:{code,message}}`.
All calls are permission-checked on the host; the Worker never receives a
direct model or DOM object.

The app runs plugin Workers and panels with an isolated CSP that blocks direct
network connections and runtime module imports. Bundle all Worker dependencies
with `buckle-plugin build`; communicate with the host through the methods below.
The current installer accepts user-reviewed local ZIPs. Optional Ed25519
signatures bind the manifest and package files and pin the first reviewed key
for updates; Buckle does not yet provide an independent publisher directory.

| Method | Params | Required grant | Result |
| --- | --- | --- | --- |
| `model.query` | none | `model.read` | Frozen canonical snapshot |
| `workspace.getSelection` | none | `workspace.readSelection` | Array of `{collection, id}` references |
| `model.execute` | `{command, expectedModelRevision?, approval?}` | Grants matching each canonical mutation | Broker outcome |
| `ui.notify` | `{message, kind?}` | `ui.notify` | `void` |
| `ui.openPanel` | `{panelId}` | `ui.panel`; panel must belong to plugin | `void` |
| `storage.get` | `{scope, key}` | `storage.project` or `storage.local` | JSON value or `undefined` |
| `storage.set` | `{scope, key, value}` | Matching storage scope | `void` |
| `storage.delete` | `{scope, key}` | Matching storage scope | Deletion result |
| `storage.keys` | `{scope}` | Matching storage scope | String keys |

`scope` is `project` or `local`. Storage is namespaced by plugin ID. The SDK
client exposes convenience methods for these calls. `model.execute` accepts a
canonical structural command; its full typed mutation builder is not part of
this alpha package yet, so mutation authors must use the host command schema
and should be treated as advanced integration partners.
`query()` returns `PluginModelSnapshot`: revision and top-level model collections
are typed, while individual entity records remain `unknown` in this alpha.

## Permission catalog

The supported Worker RPC methods above use `model.read`, `workspace.readSelection`, `ui.notify`,
`ui.panel`, `storage.project`, `storage.local` and relevant mutation grants:

```text
model.write.nodes          model.write.members        model.write.shells
model.write.loads          model.write.supports       model.write.materials
model.write.sections       model.write.grids          model.write.levels
model.write.groups         model.write.selectionSets  model.write.parametric
model.delete.nodes         model.delete.members       model.delete.shells
model.delete.loads         model.delete.supports      model.delete.materials
model.delete.sections      model.delete.grids         model.delete.levels
model.delete.groups        model.delete.selectionSets model.delete.parametric
workspace.writeSelection  workspace.visibility
```

The manifest schema also recognizes `viewport.pick`, `viewport.draw` and `viewport.zoomTo` for internal broker
surfaces. They are **not callable from a ZIP Worker's public RPC table in this
alpha**. Do not request them for a third-party ZIP. The exported
`ALL_PLUGIN_PERMISSIONS` value is the exact host catalog and includes those
reserved names.

## Limits and errors

- Signed ZIPs contain `buckle.signature.json` at package root with exactly
  `format: "buckle-ed25519-v1"`, base64-encoded 32-byte `publicKey`, and
  base64-encoded 64-byte `signature`. The signature covers UTF-8 bytes of
  `Buckle plugin bundle signature v1\n` followed by a JSON array of sorted
  `[path, sha256hex]` pairs for every file except the signature file, then `\n`.
  `buckle-plugin sign` creates this file; do not hand-construct it. Unknown or
  invalid signature formats are rejected. Unsigned local ZIPs remain allowed
  after explicit review in this alpha.

- ZIP: 8 MiB compressed, 16 MiB total declared expanded size, up to 200 entries,
  at most 1 MiB per file, and at most 200:1 compression for files above 64 KiB.
  Duplicate normalized paths are rejected. Allowed extensions are `.json`, `.js`, `.mjs`,
  `.html`, `.css`, `.svg`, `.png`, `.ico`, `.txt`.
- RPC: 256 KiB envelope limit, at most 60 calls per one-second window, five
  seconds per host call. Smaller per-method limits apply to notifications and
  storage metadata.
- Important error codes include `INVALID_MANIFEST`, `UNSUPPORTED_API_VERSION`,
  `ENTRY_MISSING`, `COMMAND_MISMATCH`, `PERMISSION_DENIED`, `INVALID_PARAMS`,
  `UNKNOWN_METHOD`, `MESSAGE_TOO_LARGE`, `TIMEOUT` and `COMMAND_FAILED`.
  Failed commands surface a message in Buckle. Model mutations already accepted
  by the broker are not rolled back merely because a later Worker step fails.

Compatible additions may be made within API v1. Any breaking envelope,
manifest or permission semantics require API v2 plus explicit host negotiation.
