# Structural Viewer — Implementation Goals

Tài liệu này chuyển kiến trúc trong `VIEWER_RENDERING_ARCHITECTURE_PLAN.md` thành
các goal tuần tự có artifact, performance gate và bước xác minh rõ ràng.

## Quy tắc thực hiện

- Chỉ một goal ở trạng thái active.
- Không bắt đầu goal sau khi gate goal trước chưa pass hoặc chưa ghi nhận waiver.
- Production baseline là Three.js/WebGL2; WebGPU không phải điều kiện hoàn thành.
- Mọi benchmark dùng cùng fixture, viewport, DPR, browser và máy khi so sánh.
- Mỗi goal phải pass correctness trước, performance sau.
- Không dùng FPS trung bình đơn lẻ; ghi AVG/P95/P99, draw calls, triangles, memory,
  scene objects, pick latency và thời gian upload/rebuild.
- Render Mode do người dùng chọn; benchmark chạy riêng cho từng mode.

## Goal queue

| Goal | Nội dung | Trạng thái |
| --- | --- | --- |
| 0 | Contract, dependency và benchmark foundation | Completed |
| 1 | StructuralSceneDB + legacy adapter | Completed |
| 2 | Render Mode setting + data-driven centerline | Completed |
| 3 | Parametric thin-shell H/I + orientation shader | Completed |
| 4 | U/L/Box/Pipe/custom thin-shell families | Completed |
| 5 | GPU ID picking + interaction buffers | Completed |
| 6 | ResultStore + stress/strain shader | Completed |
| 7 | Procedural N/V/T/M diagrams | Completed |
| 8 | SDF text + instanced structural symbols | Completed |
| 9 | Lazy solid-extrude + production hardening | Completed |
| 10 | Optional WebGPU evaluation | Deferred per user, non-blocking |

## Goal 0 — Contract, dependency và benchmark foundation

### Deliverables

- Pin và đồng bộ version `three`/`@types/three`; ghi rõ renderer baseline.
- Tạo `StructuralRenderer` contract độc lập domain model.
- Định nghĩa enum/schema cho:
  - `RenderMode = centerline-only | thin-shell | solid-extrude`;
  - `QualityProfile = low | balanced | high | custom`;
  - stable `entityId` và temporary `renderIndex`.
- Benchmark fixture generator deterministic cho 1k và 10k beam; chuẩn bị schema
  để mở rộng 50k/100k mà không lưu file JSON khổng lồ.
- Benchmark report v3 có render mode, quality profile, backend, CPU phase timing,
  draw calls, triangles, GPU resources, picking và batch diagnostics.
- Feature correctness checklist: orientation, selection, hide/show, edit/delete,
  load/result state và mode switching.

### Gate

- Production build pass.
- Fixture cùng seed cho output entity/profile/result giống nhau giữa các lần chạy.
- Benchmark 10k chạy và copy được JSON, không crash/out-of-memory.
- Không thay đổi behavior viewer hiện tại trong goal này.

### User verification

- Chạy fixture 10k ở production build.
- Gửi JSON benchmark v3 và ghi nhận mọi sai khác hình học/tương tác.

## Goal 1 — StructuralSceneDB + legacy adapter

### Deliverables

- SoA typed arrays cho node/beam/profile/flags.
- Stable domain `entityId`; dense `renderIndex` mapping hai chiều.
- Dirty-range/delta API cho create/update/delete.
- Worker-ready serialization dùng transferable `ArrayBuffer`.
- Adapter đọc model hiện tại vào SceneDB, chưa thay renderer đang hiển thị.
- React/MobX chỉ observe summary/version, không observe từng record render.

### Gate

- 100k synthetic beam được tạo trong SceneDB mà không tạo 100k Object3D.
- Mapping ID pass round-trip và update/delete compaction tests pass.
- Legacy model và SceneDB có cùng endpoints/profile/orientation IDs trên fixture.
- Main-thread long task và memory được ghi trong benchmark.

## Goal 2 — Render Mode setting + data-driven centerline

### Deliverables

- Settings UI cho ba Render Mode và Quality Profile độc lập.
- Lựa chọn được persist; viewer không tự đổi representation theo camera.
- Centerline renderer dùng một/few BufferGeometry/instanced quad batches, không một
  `Line`/`Line2` mỗi beam.
- Shader đọc start/end/render flags; screen-space width ổn định.
- Chunk/frustum culling và visibility delta.
- Selection mapping vẫn theo domain entity ID.

### Gate

- 10k centerline: model draw calls mục tiêu <= 10.
- 100k centerline: model draw calls không tăng tuyến tính; không tạo Object3D/beam.
- Orientation không ảnh hưởng centerline endpoints.
- Mode switching giữ selection/hide/filter.

### User verification

- Orbit/pan/zoom fixture 10k và gửi benchmark.
- Kiểm tra click, Ctrl-select, window-select, hide và đổi mode qua lại.

## Goal 3 — Parametric thin-shell H/I + orientation shader

### Deliverables

- Một normalized H/I thin-shell template dùng chung cho H300/H400/H... khác nhau.
- Per-instance basic dimensions: `h`, `b`, `tw`, `tf` theo schema đã khóa.
- Per-instance `start/end`, reference local axis, gamma và bit-packed flags.
- Shader tính deterministic local frame; CPU reference implementation dùng cho golden tests.
- Vertex/normal shader dựng web/flanges và world transform.
- Template giữ local `(sectionY, sectionZ, u)` để mở đường cho result shader ở Goal 6.
- H đứng/nằm ngang/xoay bất kỳ ở cùng batch.

### Gate

- 10k H/I thin-shell: model draw calls mục tiêu <= 20.
- H300/H400 thêm section definition không tạo geometry/draw call mới nếu cùng
  template/quality/material class.
- Golden fixtures pass cho horizontal, vertical, skew, gamma 0/37/90/180° và reversed I/J.
- Insertion offsets và tapered H/I được tách khỏi P0; bổ sung khi schema domain hỗ trợ.
- No per-beam Mesh/Material/Geometry.

### User verification

- Kiểm tra trực quan profile proportions và orientation trên fixture xoay mặt cắt.
- Chọn/edit gamma và xác nhận batch cập nhật đúng không rebuild toàn model.

## Goal 4 — U/L/Box/Pipe/custom thin-shell families

### Deliverables

- Parametric templates cho U/C, L, Box và Pipe.
- Quality-controlled Pipe segments.
- Mirror/flip flags cho asymmetric profiles, không dùng negative-scale sai normal.
- Simplified profile atlas/chunk path cho custom open/closed polyline.
- Unknown profile fallback rõ ràng, không crash hoặc biến mất.

### Gate

- 10k mixed standard profiles: model draw calls mục tiêu <= 50.
- Basic dimensions/proportions, winding, normals và gamma golden tests pass.
- Custom-section entropy benchmark ghi geometry/batch/memory growth.

## Goal 5 — GPU ID picking + interaction buffers

### Deliverables

- Offscreen ID pass trên WebGL2 render target.
- `renderIndex -> entityId` resolve; không dùng instanceId làm domain ID.
- Async/throttled hover readback và synchronous-safe click behavior.
- Multi-selection flag/bitset buffer, hover ID và visibility/filter flags.
- Window/crossing selection qua spatial chunks/projected bounds.
- Legacy raycast fallback chỉ cho unsupported/error path.

### Gate

- Không có O(N) scene traversal/raycast trên pointer move.
- 10k hover/picking P95 mục tiêu <= 8 ms và click resolve đúng ID.
- Selection giữ nguyên qua filter, batch compaction và Render Mode switch.
- Edit/delete/copy/hide regression checklist pass.

## Goal 6 — ResultStore + stress/strain shader

### Deliverables

- Result metadata + station/value buffers tách geometry.
- Fixed/resampled station layout trước; variable layout chỉ khi benchmark yêu cầu.
- GLSL interpolation theo `u`, physical scalar normalization và 1D color LUT.
- N/M-based stress trên profile local coordinates hoặc documented fiber-stress mode.
- Load case/combo/envelope buffer binding và legend/min/max uniforms.
- Partial upload và cache/residency policy.

### Gate

- Đổi case/component/range/palette không rebuild geometry.
- Case đã resident đổi mục tiêu <= 150 ms trên fixture 10k × 20 stations.
- Numeric interpolation fixture pass tại đầu/cuối/giữa station.
- Stress contour đúng khi gamma thay đổi; local result convention không đảo dấu.

## Goal 7 — Procedural N/V/T/M diagrams

### Deliverables

- Shared procedural ribbon/strip template đọc ResultStore.
- N/V2/V3/T/M2/M3 dùng chung framework; direction/scale là uniforms/rules.
- Undeformed/deformed reference option.
- Diagram selection/filter/visibility và extrema hooks.

### Gate

- Không tạo diagram Mesh cho từng beam.
- Component switching không rebuild model geometry.
- Numeric/golden diagrams pass cho sign, local axis, gamma và reversed I/J.
- Diagram frame budget đạt trên fixture 10k.

## Goal 8 — SDF text + instanced structural symbols

### Deliverables

- SDF/MSDF glyph atlas và instanced glyph buffer.
- Priority/declutter scheduler: selected > hovered > extrema > IDs > values.
- Label LOD độc lập Render Mode.
- Instanced load, support, reaction và local-axis symbols.
- CSS2D chỉ giữ tooltip/panel nhỏ.

### Gate

- Không có DOM/CSS2D object theo toàn bộ entity.
- Default visible label budget <= 200, configurable.
- 10k symbols không tăng draw call theo entity count.
- Selected entity luôn truy cập đủ ID/value ở mọi zoom.

## Goal 9 — Lazy solid-extrude + production hardening

### Deliverables

- Solid resources không được tạo/upload khi mode chưa được chọn.
- Shared exact `solidSignature` geometry và cache eviction policy.
- Progress/memory/triangle estimate trước khi bật trên model lớn.
- Context loss recovery, disposal/ownership và mode-switch stress tests.
- Cross-browser/WebGL2 GPU-tier regression suite.

### Gate

- Centerline/thin-shell import và memory không chịu chi phí solid.
- Solid mode đúng profile/orientation/result/selection trên P0 inspection fixture.
- Quay lại thin-shell giải phóng/caching đúng policy, không memory leak.
- Không đặt 50k–100k solid FPS làm gate nếu chưa có customer requirement.

## Goal 10 — Optional WebGPU evaluation

Goal này không chặn product release.

### Deliverables

- TSL/WebGPU prototype dùng cùng SceneDB/result/fixtures.
- Visual, numeric, interaction và performance comparison với WebGL2.
- Browser/device support matrix và failure fallback.
- ADR: adopt, defer hoặc reject kèm số liệu.

### Gate để adopt

- Feature/correctness parity với WebGL2 cho scope được bật.
- P95 frame time hoặc scale limit tốt hơn có ý nghĩa (đề xuất >= 15%), hoặc giải
  quyết một hard limit WebGL2 đã được chứng minh.
- Không làm product phụ thuộc browser/GPU chưa nằm trong support matrix.

Nếu không đạt gate, giữ WebGL2 và đóng goal bằng quyết định `defer/reject`; đây vẫn
là kết quả hợp lệ.
