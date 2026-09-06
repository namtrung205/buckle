# Goal 2 Verification Checklist

## Functional gates

- [x] Render Mode is explicitly user-controlled and persisted.
- [x] Quality Profile is explicitly user-controlled and persisted.
- [x] Camera movement never changes the selected representation.
- [x] Centerline uses one `LineSegments` batch for every member.
- [x] Nodes use one `Points` batch instead of one mesh per node.
- [x] Legacy structural objects are detached as one root in centerline mode.
- [x] Switching back to solid-extrude restores the legacy root without rebuild.
- [x] Stable EntityId mapping supports centerline hover/click selection.
- [x] Selection survives centerline -> solid-extrude mode switching.
- [x] Visibility/selection flags update the batch attributes in place.
- [x] Node endpoint delta updates do not replace the batch objects.
- [x] The global batch has a computed bound and participates in frustum culling.
- [x] Thin-shell is selectable but clearly identified as a legacy preview until Goal 3.

## Automated scale gates

- [x] 10k creates one LineSegments and one Points object.
- [x] 100k keeps the same two structural draw objects.
- [x] 15 fixture/database/renderer tests pass.
- [x] Production TypeScript/Vite build passes.
- [x] `git diff --check` passes.

## Integrated 10k production baseline — 2026-09-06

```text
Environment: Chrome 152 / AMD Radeon 780M / WebGL2
Viewport: 563 x 544 / DPR 1.25
Mode: centerline-only / balanced
Fixture: 3,731 nodes / 10,000 members

Idle:    143.75 FPS / AVG 6.96 / P95 7.8 / P99 8.7 ms
Orbit:   143.77 FPS / AVG 6.96 / P95 7.9 / P99 9.7 ms
Pointer: 142.78 FPS / AVG 7.00 / P95 9.3 / P99 10.7 ms

Draw calls: 3
Active scene objects: 18
Render submit: 0.20–0.24 ms
Raycast P95: 1.7 ms for 10,000 centerlines
SceneDB: 1,052,836 bytes / build 28.4 ms
```

Compared with the accepted legacy Firefox/R9-200 baseline, environment and viewport
differ, so FPS is not an apples-to-apples ratio. The architectural gates are still
unambiguous: draw calls fell from 33,733 to 3 and active scene traversal from 43,746
objects to 18. The user should rerun this mode on the original Firefox/R9-200 machine
for hardware-controlled comparison.
