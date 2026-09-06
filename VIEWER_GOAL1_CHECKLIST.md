# Goal 1 Verification Checklist

## Automated gates

- [x] SoA typed arrays exist for node, profile, member, flags and orientation.
- [x] Domain EntityId maps round-trip to dense RenderIndex.
- [x] Create/update/delete and swap-compaction tests pass.
- [x] Node delta rewrites only endpoints of connected members.
- [x] Profile compaction preserves member references.
- [x] Invalid member mutation is atomic.
- [x] Gamma and reference-axis survive the legacy adapter.
- [x] Profile dimensions are normalized from millimetres to SI metres.
- [x] Worker-ready transferable snapshot is available.
- [x] Deterministic 100k fixture builds without creating Object3D.
- [x] Production build and all 10 fixture/database tests pass.

## Automated scale result

```text
100,000 members SceneDB build (test runner): ~245 ms
Allocated typed-array buffers: < 20 MiB
Object3D created by SceneDB: 0
```

Timing varies by machine; this is a structural gate, not the user FPS baseline.

## User verification

Run a visible production viewer:

1. Enable `Settings -> View -> Show FPS`.
2. Click `Load 10k`.
3. Confirm the legacy geometry still looks and behaves as before.
4. Click `Run`, then `Copy`.
5. Send the v3 JSON. It must contain `sceneDatabase` with 10,000 members,
   four profiles, `byteLength`, `buildMs` and a positive version.

- [x] SceneDB reports 10,000 members and four profiles.
- [x] SceneDB build time and allocated bytes are recorded.
- [x] Legacy model remains visually unchanged and benchmark orbit/pointer phases complete.
- [x] No new React/WebGL runtime error.

Goal 1 remains active until this user verification is received. FPS is not expected
to improve yet: the visible renderer is intentionally still the legacy renderer.

## Integrated production verification — 2026-09-06

```text
Fixture: 3,731 nodes / 10,000 members / 4 profiles
SceneDB allocation: 1,052,836 bytes (~1.00 MiB)
SceneDB build: 24.60 ms
SceneDB version: 13,736
Legacy scene objects: 43,746
Legacy renderer: solid-extrude / WebGL2
Benchmark phases: idle, orbit and pointer sweep completed
Runtime result: no React or WebGL error
```

The production screenshot showed the complete structural lattice with the same
legacy member/node representation. Goal 1 can close; FPS improvement begins when
Goal 2 consumes these buffers instead of the legacy per-member objects.
