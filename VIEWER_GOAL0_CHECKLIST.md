# Goal 0 Verification Checklist

## Automated gates

- [x] `three` pinned to `0.173.0`.
- [x] `@types/three` aligned to `0.173.0`.
- [x] Vite/plugin peer versions aligned and pinned.
- [x] Deterministic 1k/10k fixture generator implemented.
- [x] Fixture exact-size, repeatability and node-reference tests pass.
- [x] Production TypeScript/Vite build passes.
- [x] Backend-independent `StructuralRenderer` contract exists.
- [x] RenderMode, QualityProfile, EntityId and RenderIndex types exist.

## Manual correctness gate

Run with a production preview and `Settings -> View -> Show FPS` enabled.

### Existing model regression

- [ ] Existing saved/example model opens with the same geometry and orientation.
- [ ] Orbit, pan, zoom and ViewCube behave normally.
- [ ] Hover, click, Ctrl multi-select and window selection behave normally.
- [ ] Hide/show, edit, copy and delete behave normally.
- [ ] Existing load/result visualization is unchanged.

### Fixture and benchmark v3

- [x] `Load 1k` replaces the current model and shows exactly 1,000 members.
- [x] `Load 10k` replaces the current model and shows exactly 10,000 members.
- [x] Fixture contains H300/H400/I300/BOX300 sections and shared nodes.
- [x] `Run` completes Warmup, Idle, Orbit and Pointer sweep.
- [x] `Copy` returns JSON with `benchmarkVersion = viewer3d-v3`.
- [x] Report contains environment/backend, Render Mode, Quality Profile, fixture
  load time, CPU update/submit/label timings, draw/triangle/resources, batch metrics
  and raycast metrics.
- [x] Browser smoke test contains no new React/WebGL error after the overlay hook-order fix.

The automated in-app browser may throttle hidden tabs, so its FPS result is only a
functional smoke test. Record the acceptance baseline from a visible browser tab.

## Baseline record required to close Goal 0

Copy the 10k JSON report and record:

```text
Browser/GPU/viewport/DPR:
Fixture seed:
Fixture load ms:

Idle FPS / AVG / P95 / P99:
Orbit FPS / AVG / P95 / P99:
Pointer FPS / AVG / P95 / P99:

CPU update / render submit / label ms:
Draw calls / triangles / geometries / textures / programs:
Scene objects / meshes / lines:
Pickables / raycast P95:

Correctness notes:
```

Goal 0 closes when the 10k report is recorded and the automated build/tests plus
viewer smoke test show no regression. The detailed interaction checklist remains a
release-regression checklist for later renderer substitutions.

## Accepted 10k baseline — 2026-09-06

```text
Browser/GPU/viewport/DPR: Firefox 155 / AMD Radeon R9 200 / 1640x765 / 1
Fixture seed: 1112884043
Fixture load ms: 19708

Idle FPS / AVG / P95 / P99: 1.85 / 541.33 / 586 / 586 ms
Orbit FPS / AVG / P95 / P99: 1.85 / 539.33 / 589 / 589 ms
Pointer FPS / AVG / P95 / P99: 1.78 / 560.33 / 622 / 622 ms

CPU update / render submit / label ms (idle): 5.43 / 460.57 / 35.14
Draw calls / triangles / geometries / textures / programs:
33733 / 11164708 / 33733 / 0 / 6
Scene objects / meshes / lines: 43746 / 23732 / 10007
Pickables / raycast P95: 23731 / 91 ms

Representation: legacy solid-extrude, balanced, WebGL2
Primary bottleneck: per-object/per-geometry render submission and draw calls.
```

This baseline is the comparison point for subsequent renderer goals. The legacy
renderer has zero instanced or batched meshes; therefore triangle reduction alone
cannot meet the FPS target without changing the render architecture.
