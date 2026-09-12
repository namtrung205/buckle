# Hello Buckle — zip-loaded sample plugin

A minimal external plugin bundle you can load straight from the client.

## Run it

1. Validate the manifest:
   ```
   cd frontend
   node --experimental-strip-types scripts/buckle-plugin.ts validate examples/hello-plugin
   ```
2. Package it (zip the **folder contents** so `buckle.plugin.json` sits at the zip root):
   - Explorer: right-click the two files → *Compress to ZIP file*.
   - PowerShell: `Compress-Archive -Path examples/hello-plugin/* -DestinationPath hello-buckle.zip`.
3. Start the app (`npm run dev`) and in the bottom-left **Plugin loader** box click
   **Install**, pick `hello-buckle.zip`.

It requests `model.read + ui.notify`, spawns its `worker.js` in the sandboxed
Worker runtime, reads the model snapshot over RPC and shows a toast. A ribbon
button/tab (Examples → Say hello) demonstrates manifest contributions.

## Notes

- The manifest is validated fail-closed (`validateManifest`); unknown
  permissions are rejected before anything runs.
- Bundled files must be one of `.json/.js/.mjs/.html/.css/.svg/.png/.ico/.txt`;
  paths containing `..` are rejected (zip-slip guard).
- Panels inside a zip must be **self-contained** HTML for client-side loading
  (scripts/styles inlined); worker entrypoints run in the blob Worker sandbox.
- The loader is session-only: reload the page to unload everything.