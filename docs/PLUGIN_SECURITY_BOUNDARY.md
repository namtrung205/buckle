# Local plugin security boundary (alpha)

Buckle accepts a ZIP only after a local user selects it and reviews its manifest
permissions. Installed ZIPs may restart automatically while enabled. This is a
**trusted-local-file policy**. A signed ZIP provides key continuity after the
first reviewed install, but there is no publisher directory or certificate
authority. Do not distribute this alpha as a safe runner for arbitrary unknown ZIPs.

## Execution boundary

- Worker source is bundled into one file, then passed as bytes to a hidden
  `sandbox="allow-scripts"` iframe without `allow-same-origin`. Its bootstrap
  creates a `data:` module Worker. The frame verifies the parent message source
  and a random per-session token; the host verifies the frame source and token.
  The Worker only reaches Buckle through validated postMessage RPC.
- The frame adds CSP `connect-src 'none'`, restricts scripts/workers to inline or
  `data:` code, and blocks frames, objects, images, media, fonts and forms. The
  Worker inherits that CSP. It cannot fetch Buckle's origin or use network APIs
  permitted to the main app. The SDK CLI bundles imports so the Worker does not
  need runtime module fetches.
- Panels run in an iframe with `sandbox="allow-scripts"` and no
  `allow-same-origin`. A CSP meta tag is inserted **before plugin markup** and
  blocks direct connections and external resources. The panel talks to Buckle
  through its source-checked RPC bridge.
- The host validates ZIP limits, manifest permissions, RPC method/size/rate,
  command registrations, and model mutation policy. Worker crashes disable the
  plugin; repeated crashes quarantine it. Kill switch stops live plugins.
- The exact ZIP bytes selected during permission review are pinned with SHA-256.
  Restore and re-enable recompute the digest before parsing or running code.
  Changed ZIPs and alpha installs created before this fingerprint existed stay
  disabled until the user reinstalls them. This protects against unnoticed
  changes in local persistence, not a publisher who supplied malicious bytes.
- Optional `buckle.signature.json` contains an Ed25519 public key and signature
  over a canonical sorted list of every logical package file's path and SHA-256
  (excluding the signature file itself). Invalid signatures fail closed. The
  first signed install pins the public-key SHA-256; updates must use the same
  key. A local key blocklist immediately stops matching plugins and prevents
  install, restore or re-enable until the user unblocks it.

The browser origin/CSP behavior follows the [Worker constructor](https://developer.mozilla.org/en-US/docs/Web/API/Worker/Worker)
and [Web Worker CSP](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)
documentation. Manual Edge browser fixtures in `frontend/tests/browser` compare
same-origin access from the old direct `blob:` Worker with the new isolated
transport, test Worker message round-trips and denied network access, and run
the sample ZIP's Worker through the host protocol. The panel fixture confirms
inline code runs while network access is blocked. A separate Edge fixture verifies
an Ed25519 signature produced by Node and rejects a modified message.

## Remaining release gates

- The first signed install is trust-on-review: an attacker who substitutes both
  ZIP and key before the user reviews it can still be accepted. Add an
  independently distributed publisher-key directory or fingerprints, key
  rotation protocol and authenticated revocation feed before treating remote
  ZIPs as trusted. The old `PluginTrustStore` keyed manifest digest is not used
  by the live ZIP installer and remains unrelated to Ed25519 signatures.
- Run the browser fixtures in CI across supported engines. Verify panel
  navigation, nested workers, storage APIs, cross-origin requests and resource
  exhaustion adversarially. CSP limits network APIs, but is not a CPU/memory
  quota or a complete guarantee against every browser channel.
- Make update identity and publisher metadata explicit in the manifest and
  review UI. An updated ZIP currently requires user review but does not prove
  continuity with a publisher key.
