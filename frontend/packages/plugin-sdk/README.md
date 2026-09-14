# @buckle/plugin-sdk (alpha)

See the [Vietnamese developer guide](DEVELOPER_GUIDE.vi.md)
for a complete create → build ZIP → install walkthrough, and the
[API v1 reference](API_V1.md) for methods and permissions.

Build a Buckle plugin without importing Buckle application source. This package
is currently a local alpha tarball; it has **not** been published to npm.

## Create and build

After obtaining `buckle-plugin-sdk-0.1.0-alpha.1.tgz`:

```sh
npm exec --package ./buckle-plugin-sdk-0.1.0-alpha.1.tgz -- buckle-plugin init my-plugin
cd my-plugin
npm install ../buckle-plugin-sdk-0.1.0-alpha.1.tgz
npm run check
npm run build
```

The CLI writes `dist/<plugin-id>-<version>.zip`. In Buckle, open **File → Manage
plugins → Install** and select the ZIP. After reviewing permissions, Buckle
stores the ZIP locally and restores enabled plugins on reload. Manage plugins
also lets users disable, re-enable, update or uninstall them. The CLI's `validate` command accepts a plugin
directory (manifest check) or a finished ZIP (full loader check).

The generated project is the smallest working template: a TypeScript Worker,
manifest, panel and ribbon command. Edit its `buckle.plugin.json` ID and
permissions before sharing it. `npm run build` bundles the Worker and inline
panel assets into one ZIP. A ZIP must contain `buckle.plugin.json` at its root.
The [Hello Buckle sample](../../examples/hello-plugin/README.md) uses the same
SDK from Worker and panel; its ready-to-install ZIP is
[`hello-buckle.zip`](../../examples/hello-buckle.zip).
The [Bulk Rename sample](../../examples/bulk-rename-plugin/README.md) shows
selection reads, model transactions and a right-side panel. Its ready-to-install
ZIP is [`bulk-rename.zip`](../../examples/bulk-rename.zip).

For maintainers, `npm run test:external` packs the SDK, creates a project outside
this repository, installs that tarball, type-checks and builds the starter,
then installs its ZIP into the app's real plugin lifecycle and invokes its
command. This protects the documented workflow from regressions.

## Sign a ZIP for updates

Generate a publisher key once and keep its private file outside the plugin ZIP:

```sh
npx buckle-plugin keygen publisher
npx buckle-plugin sign dist/com.example.my-plugin-1.0.0.zip --key publisher.private.pem
npx buckle-plugin validate dist/com.example.my-plugin-1.0.0.signed.zip
```

Share the `.signed.zip` file. `keygen` writes `publisher.private.pem` and
`publisher.public.txt` without overwriting existing files. Protect and back up
the private key; never commit or include it in a ZIP. The signature covers the
manifest and every file in the logical ZIP package. Buckle verifies it before
installation, restore and enable, displays the public-key SHA-256 during review,
and pins that key for subsequent updates. A signed plugin cannot update with a
different key or an unsigned ZIP. Users can block or unblock a publisher key
locally in Manage plugins.

Unsigned local ZIPs remain allowed in this alpha after explicit user review.
The first signed install still relies on the user to recognize and trust the
publisher key; Buckle does not yet ship a certificate authority, publisher
directory or remote revocation feed. Browser support for Ed25519 must be
verified before a public release.

## Worker API

```ts
import { createWorkerPlugin } from '@buckle/plugin-sdk'

const plugin = createWorkerPlugin({
  'com.example.my-plugin.open': async api => {
    await api.openPanel('com.example.my-plugin.panel')
  },
})

void plugin.api.query().then(snapshot => console.log(snapshot))
```

Every manifest command must have a handler with the same ID. The SDK announces
the handlers to Buckle; Buckle rejects the ZIP at activation if the IDs do not
match. A command click waits up to five seconds for a result. `dispose()`
removes message listeners and rejects pending calls.

| Method | Required grant | Argument / result |
| --- | --- | --- |
| `query()` | `model.read` | `PluginModelSnapshot` with typed top-level collections and revision; entity records remain `unknown` |
| `getSelection()` | `workspace.readSelection` | Current `{collection, id}` entity references |
| `execute(command, expectedRevision?)` | Matching `model.write.*` or `model.delete.*` | Canonical structural command / broker outcome |
| `notify(message, kind?)` | `ui.notify` | Toast / `void` |
| `openPanel(panelId)` | `ui.panel` | Namespaced panel ID / `void` |
| `storageGet/Set/Delete/Keys(scope, ...)` | `storage.project` or `storage.local` | Namespaced JSON values |

The host validates every RPC call and the manifest's permission list. Unknown
methods and permissions are rejected. The package exports `PluginManifest`,
`PluginSessionPermission`, the complete permission constants and
`validateManifest` from the same contract used by Buckle.

API version 1 is the only supported version. Additions within v1 must remain
compatible; a breaking wire/schema change requires a new API version. Do not
request permissions your plugin does not use. `worker.js` must be a single
bundled module; panel HTML must contain its scripts/styles rather than loading
sibling ZIP files. The CLI handles both requirements for the generated project.
