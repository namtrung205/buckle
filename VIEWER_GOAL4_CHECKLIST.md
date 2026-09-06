# Goal 4 Verification Checklist

## Functional gates

- [x] U/Channel, L/Angle, Box and Pipe use shared parametric family templates.
- [x] H and I profiles continue to share the normalized H/I family batch.
- [x] Per-instance buffers carry endpoints, local reference axis, gamma, profile dimensions, entity flags and orientation flags.
- [x] Mirror Y/Z is applied analytically in the shader without negative `Object3D` scale or inverted normals.
- [x] Pipe radial segments follow the selected quality profile (8/12/20 for low/balanced/high).
- [x] Custom open and closed contours generate normalized shared profile templates.
- [x] Custom members with the same profile reuse one geometry and one draw batch.
- [x] Unknown/unsupported profiles remain visible through an explicit batched centerline fallback.
- [x] Selection, hover and visibility flags work across every instanced family.
- [x] Profile-family changes repartition instances without rebuilding the scene graph.
- [x] A reused batch can grow from 1k to 10k without retaining Three.js's stale `_maxInstanceCount` cache.
- [x] Click selection in the integrated thin-shell viewer updates the status counter.

## Automated correctness and scale gates

- [x] Golden topology and normal tests cover all standard families and custom contours.
- [x] Golden orientation tests cover horizontal, vertical, skew, reversed and gamma 0/37/90/180 degrees.
- [x] 10k and 100k mixed fixtures keep a constant number of standard renderer objects.
- [x] Custom entropy grows with unique contour/profile topology, not member count.
- [x] StructuralSceneDB transferable snapshot v2 preserves contours and mirror flags.
- [x] 31 fixture/database/renderer tests pass.
- [x] Production TypeScript/Vite build passes.
- [x] `git diff --check` passes (line-ending notices only).

## Integrated 10k production benchmark — 2026-09-06

```text
Environment: Chrome 152 / AMD Radeon 780M / WebGL2
Viewport: 540 x 758 / DPR 1
Mode: thin-shell / high
Fixture: 3,731 nodes / 10,000 members / 7 profile definitions
Active standard families: H/I, U/Channel, L/Angle, Box, Pipe

Idle:    143.74 FPS / AVG 6.96 / P95 7.3 / P99 8.0 ms
Orbit:   143.74 FPS / AVG 6.96 / P95 7.8 / P99 11.0 ms
Pointer: 143.42 FPS / AVG 6.97 / P95 8.0 / P99 9.7 ms

Total scene draw calls: 7
Thin-shell instanced meshes: 5
Thin-shell instances: 10,000
Triangles: 160,744
Active scene objects: 25
Render submit: 0.22–0.23 ms
Raycast P95: 1.7 ms for 10,000 pickables
SceneDB: 1,069,384 bytes / build 29.4 ms
```

The mixed fixture holds one instanced draw batch per active standard family; its
draw-call count therefore grows with family/topology count rather than beam count.
The 1k -> 10k runtime regression check increased rendered triangles from 16,064 to
160,744 while keeping seven total scene draw calls, proving the larger instance
buffers are submitted rather than merely reported by diagnostics.

## Known limits and deferred work

- The domain/UI section editor does not yet expose arbitrary custom contour input;
  the SceneDB and renderer contract supports it and is covered by automated tests.
- Each unique custom profile contour currently owns one batch. A topology atlas or
  chunk strategy is only needed if real models contain high custom-profile entropy.
- Rectangular/Tee and other families outside Goal 4 use the explicit fallback path.
- Fixture load time (27.8 seconds) is dominated by legacy domain objects and eager
  solid-extrude resources, not the 29.4 ms SceneDB build or thin-shell submission.
- Window/crossing selection, unified selection state and right-click edit for the
  data-driven modes remain Goal 5 interaction work.
- Chunk frustum culling, streaming and lazy solid-extrude lifecycle remain later
  production-hardening work.

### User verification

- Inspect U/L/Box/Pipe proportions and rotated/mirrored asymmetric profiles with a
  representative engineering model.
- Supply one or more real custom sections after the section editor exposes contours,
  then compare visual orientation and custom-profile batch entropy.
