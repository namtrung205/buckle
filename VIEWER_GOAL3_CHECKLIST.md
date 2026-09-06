# Goal 3 Verification Checklist

## Functional gates

- [x] Thin-shell mode uses a real parametric GPU renderer, not legacy solid meshes.
- [x] H300, H400 and I300 share one normalized H/I topology.
- [x] Per-instance buffers carry start/end, reference axis, gamma, h/b/tw/tf and flags.
- [x] The vertex shader reconstructs member axes and arbitrary section rotation.
- [x] The 36-vertex template represents two flange skins and two web skins.
- [x] Selection, hover and visibility use bit-packed GPU flags.
- [x] Click picking reuses the batched centerline acceleration path.
- [x] Thin-shell -> solid-extrude -> thin-shell preserves selection without rebuilding.
- [x] Coordinate, gamma and profile-dimension deltas update attributes in place.
- [x] Profile family changes repartition safely between H/I and fallback batches.
- [x] Unsupported families remain visible as a one-draw fallback centerline.
- [x] Empty databases submit zero instances.

## Automated scale and correctness gates

- [x] Golden frame tests cover horizontal, vertical, skew and reversed members.
- [x] Golden gamma tests cover 0, 37, 90 and 180 degrees.
- [x] Frame tests verify normalized, orthogonal and right-handed axes.
- [x] 10k and 100k fixtures keep the same two structural render objects.
- [x] 24 fixture/database/renderer tests pass.
- [x] Production TypeScript/Vite build passes.
- [x] `git diff --check` passes (line-ending notices only).

## Integrated 10k production benchmark — 2026-09-06

```text
Environment: Chrome 152 / AMD Radeon 780M / WebGL2
Viewport: 540 x 758 / DPR 1
Mode: thin-shell / high
Fixture: 3,731 nodes / 10,000 members
H/I instances: 7,437; non-H fallback members: 2,563

Idle:    143.82 FPS / AVG 6.95 / P95 7.5 / P99 9.5 ms
Orbit:   143.77 FPS / AVG 6.96 / P95 7.6 / P99 8.7 ms
Pointer: 143.84 FPS / AVG 6.95 / P95 9.2 / P99 10.7 ms

Draw calls: 4
Triangles: 89,244
Active scene objects: 21
Render submit: 0.18–0.21 ms
Raycast P95: 1.8 ms for 10,000 members
SceneDB: 1,052,836 bytes / build 33.5 ms
```

The architectural target of at most 20 draw calls is exceeded positively: the
10k mixed-profile fixture uses four total scene draw calls. H300/H400/I300 remain
one H/I draw batch; BOX members use one fallback line batch until Goal 4.

The fixture's 24.3-second load time and retained legacy geometry memory are not
thin-shell render costs: solid-extrude resources are still built and retained so
mode switching is immediate. Avoiding that legacy build for large-model sessions
requires a later lazy solid-resource lifecycle goal.

## Deferred to later goals

- U/L/Box/Pipe/custom profile surfaces (Goal 4).
- Chunk frustum culling and large-model streaming (Goal 5).
- Stress/result station buffers and color-map shader (Goal 6).
- Insertion offsets and tapered H/I after the domain schema exposes them.
