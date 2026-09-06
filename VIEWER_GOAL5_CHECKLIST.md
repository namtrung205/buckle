# Goal 5 Verification Checklist

## Functional gates

- [x] Centerline and thin-shell modes use one offscreen WebGL2 ID pass rather than per-member raycasts.
- [x] The pick buffer stores dense `renderIndex` values and resolves them back to stable domain `entityId` values.
- [x] Pointer hover is throttled to one request per animation frame and reuses the cached ID target while camera/model state is unchanged.
- [x] Click selection, Ctrl multi-selection, hover and visibility use shared entity flag buffers.
- [x] Window selection requires both projected endpoints inside for left-to-right drags.
- [x] Crossing selection accepts endpoint containment or segment/rectangle intersection for right-to-left drags.
- [x] Rectangle selection queries prebuilt spatial chunks only on pointer-up.
- [x] Selection is canonical across centerline/thin-shell mode switches and synchronizes to retained legacy objects when entering solid-extrude.
- [x] Status bar and FPS overlay report data-driven member selections.
- [x] Right-click Edit, Copy, Hide and Delete actions consume the same canonical member IDs.
- [x] Hidden state survives render-mode switches and global member/section visibility toggles.
- [x] Property changes and deletes coalesce into one SceneDB rebuild; stable selection/visibility flags survive dense compaction.
- [x] Benchmark execution preserves the user's pre-existing selection and reports main-scene stats rather than the offscreen pass stats.

## Automated correctness and scale gates

- [x] Sparse entity IDs, RGB encode/decode and the no-hit sentinel have deterministic tests.
- [x] Window/crossing semantics and hidden-member exclusion have deterministic tests.
- [x] Entity resolution remains stable after dense member compaction.
- [x] Pointer movement performs no O(N) scene traversal or Three.js raycast in data-driven modes.
- [x] 36 fixture/database/renderer/picking tests pass.
- [x] Production TypeScript/Vite build passes.
- [x] `git diff --check` passes (line-ending notices only).

## Integrated 10k production benchmark — 2026-09-06

```text
Environment: Chrome 152 / AMD Radeon 780M / WebGL2
Viewport: 540 x 758 / DPR 1
Mode: centerline-only / high
Fixture: 3,731 nodes / 10,000 members

Idle:    143.52 FPS / AVG 6.97 / P95 7.7 / P99 10.4 ms
Orbit:   143.74 FPS / AVG 6.96 / P95 7.9 / P99 8.9 ms
Pointer: 139.74 FPS / AVG 7.16 / P95 9.7 / P99 11.7 ms

GPU picking P95: 3.1 ms for 10,000 pickables
Main scene draw calls: 3
Rendered lines: 10,102
SceneDB build: 30.2 ms
```

An additional thin-shell/high run held approximately 139 FPS during the pointer
sweep with GPU picking P95 at 3.5 ms. Both data-driven modes are below the Goal 5
8 ms picking gate on the same 10k fixture.

## Runtime interaction verification

- [x] Click in thin-shell selects one member and the status bar shows `1 Member`.
- [x] The same selection remains active after switching thin-shell to centerline.
- [x] Right-click in both modes opens member actions from the canonical selection.
- [x] Edit opens the correct member property panel (verified with M811).
- [x] Hide clears the selection/status and removes the entity through its shared visibility flag.
- [x] Copy synchronizes selected domain IDs to the existing legacy copy workflow.
- [x] Delete schedules SceneDB resynchronization; compaction/ID resolution is covered by the automated golden test.

## Known limits and deferred work

- GPU ID picking in Goal 5 targets structural members. Data-driven node picking is deferred until nodes gain their own interaction representation.
- WebGL2 `readRenderTargetPixels` is synchronous. The cached render target and frame throttling meet the current 10k latency gate; PBO/fence-based asynchronous readback remains an optional later optimization.
- The pick target currently matches the drawing-buffer size. A scaled target or small scissored pick pass may reduce memory and invalidation cost on 4K displays.
- Window/crossing selection uses projected member segments. Profile-volume intersection is intentionally not part of the simplified data-driven selection contract.

### User verification

- Verify hover, click, Ctrl multi-select and both drag directions on the representative large engineering model.
- Verify right-click Edit/Copy/Hide/Delete against normal project data, especially after filtering and switching all three Render Modes.
