# Structural Viewer & AI-native Modeling — Implementation Goals

Tài liệu này chuyển kiến trúc trong `VIEWER_RENDERING_ARCHITECTURE_PLAN.md` thành
các goal tuần tự có artifact, performance gate và bước xác minh rõ ràng; đồng thời
bổ sung roadmap AI-native để tăng tốc dựng hình, truy vấn và cập nhật mô hình.

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
| 11 | AI foundation reset: build, schema, units và analysis validation | Implemented — UI verification pending; legacy lint waived |
| 12 | Pure Structural Model Core + versioned document | Completed — core, analysis, export và render-mode smoke passed |
| 13 | Command Bus + transaction + undo/redo | Planned — next |
| 14 | Parametric object kernel + regenerate/diff | Planned |
| 15 | AI Tool Registry + modes + permission policy | Planned |
| 16 | AI Copilot MVP end-to-end | Planned |
| 17 | Fast inspect/select/edit workflows | Planned |
| 18 | Fast parametric generation workflows | Planned |
| 19 | AI safety, evals, observability và production gate | Planned |
| 20 | Production MCP adapter | Planned after Goal 19 |
| 21 | Optional project-knowledge RAG | Deferred, non-blocking |

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

---

# AI-native modeling goals

## Phạm vi và nguyên tắc bắt buộc

Chuỗi Goal 11–21 bổ sung AI như một phương thức điều khiển mới trên cùng model với
mouse và property panel. Mục tiêu sản phẩm là rút ngắn thời gian dựng hình, chọn đối
tượng và chỉnh sửa hàng loạt; AI không thay thế geometry engine hoặc analysis engine.

Các invariant không được phá vỡ:

- Mọi mutation từ UI, AI, script hoặc MCP đều đi qua cùng `Command Bus`.
- AI không gọi `scene.add`, không sửa `THREE.Object3D`, MobX array hoặc GPU buffer.
- Structural Model Core là source of truth; `StructuralSceneDB` là read projection
  dành cho renderer; OpenSees nhận immutable analysis snapshot.
- Canonical engineering frame là Z-up. Chuyển đổi sang Three.js Y-up chỉ xảy ra ở
  renderer/import-export boundary.
- Canonical unit phải được khóa trong schema; prompt không được tự suy đoán đơn vị
  khi câu lệnh mơ hồ có thể làm thay đổi đáng kể mô hình.
- Mỗi command có `commandId`, `modelRevision`, validation, audit record và kết quả
  xác định. Retry cùng `commandId` không được tạo entity trùng.
- Tác vụ nhiều bước phải atomic hoặc trả về preview; không để lại model dở dang.
- API key/model provider chỉ tồn tại phía server. Frontend không gọi provider trực tiếp.
- Kết quả AI luôn phân biệt `planned`, `previewed`, `applied`, `rejected`, `failed`.
- RAG không được dùng để đếm, lọc hoặc suy đoán trạng thái chính xác của model.

## Product success metrics

Các số liệu này dùng xuyên suốt Goal 11–19:

- `Command apply latency`: P95 <= 100 ms cho edit 100 entity và <= 1.0 s cho batch
  10.000 entity, không tính thời gian LLM.
- `Visible update latency`: viewport phản ánh committed change ở frame kế tiếp hoặc
  trong <= 100 ms sau khi render projection nhận change set.
- `Atomicity`: 100% command validation fail không thay đổi model revision hoặc scene.
- `Undo fidelity`: apply -> undo trả model về canonical snapshot byte-equivalent,
  ngoại trừ metadata thời gian/audit.
- `Tool-call validity`: >= 98% tool calls hợp lệ trên bộ eval deterministic P0.
- `Task completion`: >= 90% prompt P0 hoàn thành đúng mà không cần người dùng sửa
  JSON/tool arguments thủ công.
- `Safety`: 100% delete, replace-model và batch edit vượt ngưỡng policy phải preview
  hoặc xin xác nhận trước khi apply.
- `Geometry correctness`: cùng input parametric + seed sinh cùng entity graph và IDs.

Các latency liên quan LLM phải báo riêng `time-to-first-token`, `planning latency`,
`tool execution latency` và `total task latency`; không gộp thành một con số.

## Milestone map

| Milestone | Goals | Outcome |
| --- | --- | --- |
| M0 — Trustworthy baseline | 11 | Build/test/schema/analysis đủ tin cậy để AI dùng |
| M1 — One mutation path | 12–13 | UI và AI cùng thao tác qua Model Core + Command Bus |
| M2 — AI Copilot MVP | 14–16 | Chat có thể inspect, create, select, update và undo |
| M3 — Modeling accelerator | 17–18 | Edit hàng loạt và dựng kết cấu parametric nhanh |
| M4 — Production AI | 19 | Safety, eval, audit, security và release gate |
| M5 — External ecosystem | 20–21 | MCP và RAG tùy nhu cầu, không chặn M4 |

## Ước lượng delivery và nhân sự

Ước lượng dưới đây giả định một nhóm tối thiểu gồm một frontend/3D engineer, một
backend/AI engineer và một structural engineer review bán thời gian. Đây là khoảng
ước lượng để lập kế hoạch, không phải deadline; sau Goal 11 phải hiệu chỉnh lại bằng
velocity thực tế và số lượng legacy mutation path cần migrate.

| Milestone | Priority | Thời lượng mục tiêu | Release |
| --- | --- | --- | --- |
| M0 — Goal 11 | P0 | 1–2 tuần | Engineering baseline |
| M1 — Goals 12–13 | P0 | 5–8 tuần | Internal core preview |
| M2 — Goals 14–16 | P0 | 5–8 tuần | AI Copilot internal alpha |
| M3 — Goals 17–18 | P1 | 4–7 tuần | Modeling accelerator beta |
| M4 — Goal 19 | P0 release gate | 2–4 tuần | External beta candidate |
| M5 — Goals 20–21 | P2 | 2–3 + 3–5 tuần | Optional integrations |

Với một engineer duy nhất, dùng hệ số khoảng 1,7–2,0 cho M0–M4 vì core migration,
AI orchestration và structural validation khó triển khai song song an toàn.

## Goal 11 — AI foundation reset: build, schema, units và analysis validation

Goal này là prerequisite bắt buộc cho toàn bộ AI stream. Không expose mutation tool
cho LLM khi gate chưa pass.

### Implementation record — 2026-09-08

- Canonical Pydantic v1 contract, generated JSON Schema, `schemaVersion`, reference
  validation và machine-readable 422 errors đã được tích hợp vào `/analysis`, MCP và
  frontend transport DTO.
- Z-up engineering transport, Y-up rendering conversion và unit boundary đã được khóa
  trong code + ADR 0001. Import/export giữ `vecxz`, `gamma`, release, support rotation,
  tải và stable IDs.
- Automated suite hiện pass: production build, 66 frontend fixture/render tests, 43
  backend/API/contract/regression tests và analytical beam benchmark.
- CI dùng clean pinned Node/Python runtime, kiểm tra schema drift và lưu JUnit + benchmark
  artifact theo commit SHA.
- Waiver theo quyết định người dùng: legacy frontend lint vẫn được chạy để quan sát nhưng
  không chặn Goal 11/CI. Chỉ TypeScript/build error và correctness error là blocking.
- Còn chờ user verification: mở lại example models và đối chiếu tối thiểu ba case từ UI.

### Deliverables

- Đồng bộ sạch `package.json`, lockfile và installed dependency; pin Three.js/types,
  Vite/plugin, Node và Python runtime.
- Production build, lint và frontend/backend tests chạy trong CI từ clean checkout.
- Thay request `dict` của `/analysis` bằng versioned Pydantic DTO; sinh JSON Schema từ
  một nguồn và dùng cùng contract cho frontend, backend, tools và fixtures.
- Khóa unit contract:
  - coordinates: metre;
  - section dimensions: millimetre ở transport boundary, normalize sang metre trong core;
  - material modulus/strength: pascal;
  - nodal load: kN; line load: kN/m; pressure: kN/m²;
  - angle: degree ở UI/transport, radian chỉ trong computation internals.
- Thêm `schemaVersion`, migration policy và validation errors có `path`, `code`,
  `expected`, `received`.
- Sửa lệch contract `nodei/nodej`, section types, boundary condition naming và
  Y-up/Z-up giữa export/import, WebSocket và MCP prototype.
- Biến benchmark dầm giản đơn thành automated golden test; bổ sung portal frame,
  releases, inclined member, shell pressure và mixed beam-shell fixtures.
- Ghi ADR về accuracy tolerance, rounding policy và phạm vi analysis được chứng nhận.

### Gate

- `npm ci && npm run build && npm run lint && npm run test:fixture` pass từ clean tree.
- Backend test pass 100%; không còn test gọi route/schema đã bỏ.
- OpenAPI request schema và exported shared schema tương thích bằng contract test.
- Mọi fixture round-trip JSON -> core -> JSON giữ IDs, axes, units và relationships.
- Analytical benchmarks đạt tolerance đã duyệt; không chỉ reaction/moment mà cả
  displacement và local-axis sign convention.
- CI lưu test report và benchmark artifact theo commit SHA.

### User verification

- Mở lại toàn bộ example model; kiểm tra kích thước, hướng trục, tải và section.
- Chạy ít nhất ba benchmark từ UI và đối chiếu bảng kết quả đã duyệt.

## Goal 12 — Pure Structural Model Core + versioned document

### Implementation record — 2026-09-08

- Đã tạo `StructuralDocument` TypeScript thuần với normalized entity records, typed
  `{ collection, id }` references/index (kể cả Group/ParametricObject), document
  version, revision, dirty state, subscription và atomic reconciliation.
- Canonical snapshot + deterministic FNV-1a 64-bit semantic hash không phụ thuộc thứ
  tự input; versioned restore từ chối document/schema version chưa hỗ trợ.
- CRUD/cascade validation giữ topology hợp lệ; invalid update không commit, không tăng
  revision và không phát event.
- `WorkspaceContext` tách selection/hover/focus/tool/view/draft khỏi persisted model và
  analysis hash; Selector hiện mirror selection/hover và navigation tool vào context.
- `StructuralDocumentBridge` chuyển Z-up core sang Y-up render database bằng incremental
  add/update/delete; node change chỉ dirty node và connected members.
- Import validate vào core trước khi tạo legacy scene; export và `/analysis` dùng frozen
  `AnalysisSnapshot` có revision/hash. Stale result bị loại nếu model đổi khi đang chạy.
- 100.000 member core test pass không cần DOM/WebGL/Object3D. Tổng frontend suite hiện
  81 tests pass; backend suite 43 tests pass; production TypeScript/Vite build pass.
- UI smoke test đã load fixture 1.000 members; dựng frame 2 nhịp (45 nodes, 84 members),
  phân tích OpenSees thành công trong 2,961 giây, và giữ nguyên một member selection khi
  chuyển Centerline/Thin shell/Solid extrude; sửa regression `DataCloneError` do MobX
  observable proxy.
- ADR 0002 ghi ownership boundary và checklist xóa legacy adapter trong Goal 13.
- Còn chờ user verification cuối: export/reload file riêng của user và đối chiếu thuộc
  tính/kết quả; luồng generator/analyze và selection qua ba Render Mode đã smoke pass.

### Deliverables

- Tạo core TypeScript thuần, không import Three.js, React, MobX UI hoặc DOM.
- Định nghĩa entity records cho `Node`, `Member1D`, `Shell2D`, `Section`, `Material`,
  `Load`, `BoundaryCondition`, `Grid`, `Level`, `Group` và `ParametricObject`.
- Dùng stable entity ID, typed references và index phục vụ query; không duplicate toàn
  bộ node object trong mỗi member.
- Tách `StructuralDocument` (persisted engineering state) khỏi `WorkspaceContext`
  (selection, hover, active view, active tool và draft chưa commit).
- Có revision number, change events, dirty state và deterministic canonical snapshot.
- `StructuralSceneDB` nhận incremental change set từ core; legacy model adapter chỉ tồn
  tại trong migration period và có removal checklist.
- OpenSees adapter chỉ nhận immutable `AnalysisSnapshot`, không đọc Three.js/MobX state.
- Import/export và persistence gọi core serializer; renderer không phải nguồn export.

### Gate

- Core tests chạy trong Node không cần WebGL, canvas hoặc browser globals.
- Create/update/delete cascade giữ topology hợp lệ; dangling references bị từ chối.
- 100.000 member records tạo được mà không có Object3D và không phụ thuộc renderer.
- Một core change chỉ cập nhật đúng dirty ranges trong `StructuralSceneDB`.
- Snapshot hash deterministic cho cùng model; migration fixtures giữ nguyên nghĩa.
- UI hiện tại mở, edit, analyze và export model qua core mà không regression P0.

### User verification

- Dựng và sửa một frame bằng UI cũ, reload model và so sánh entity/property/result.
- Chuyển ba Render Mode trong khi selection/workspace context vẫn đúng.

## Goal 13 — Command Bus + transaction + undo/redo

### Deliverables

- Một `CommandGateway.execute(command, context)` là mutation entry point duy nhất.
- Command envelope gồm `commandId`, `type`, `schemaVersion`, `modelRevision`,
  `payload`, `source`, `dryRun` và optional `transactionId`.
- Command P0:
  - `CreateNodes`, `MoveNodes`, `DeleteNodes`;
  - `CreateMembers`, `UpdateMembers`, `DeleteMembers`;
  - `CreateOrUpdateSections`, `CreateOrUpdateMaterials`;
  - `CreateOrUpdateLoads`, `CreateOrUpdateBoundaryConditions`;
  - `SetSelection`, `HideEntities`, `ShowEntities`;
  - `ImportModel`, `ClearModel` với destructive policy riêng.
- Batch command nhận local references/aliases để member có thể tham chiếu node được tạo
  trong cùng transaction mà không cần LLM đoán ID.
- Transaction validate toàn bộ trước commit; rollback toàn bộ nếu một operation fail.
- Undo/redo dựa trên inverse command hoặc before/after patch có kiểm soát bộ nhớ.
- Optimistic concurrency qua `expectedModelRevision`; lỗi conflict trả change summary.
- UI hiện có được migrate dần sang command path; cấm code mới push trực tiếp vào model arrays.

### Gate

- 100% mutation actions P0 từ UI đi qua Command Gateway.
- Batch 10.000 entity đạt performance budget và tạo một undo step.
- Retry idempotency, stale revision, rollback và cascade delete có deterministic tests.
- Apply -> undo -> redo giữ snapshot hash và stable IDs.
- Invalid command không phát render event, analysis invalidation hoặc partial audit entry.

### User verification

- Thực hiện draw, property edit, copy, batch section change và delete từ UI; mỗi thao
  tác undo/redo đúng một bước và giữ selection hợp lý.

## Goal 14 — Parametric object kernel + regenerate/diff

### Deliverables

- `ParametricObject` lưu `kind`, versioned parameters, owned entity IDs, constraints,
  generator version và generation provenance.
- Generator là pure function: parameters + referenced catalogue -> proposed entity graph.
- Diff engine so sánh graph cũ/mới và giữ stable IDs khi semantic role không đổi.
- Regenerate chạy trong một transaction, cho preview số entity add/update/delete.
- Tách Warehouse Wizard khỏi React component thành `WarehouseGenerator` domain service.
- Chuyển Tower generator sang cùng contract; UI wizard chỉ thu parameters và gọi command.
- P0 parametric kinds: `Grid`, `PortalFrame`, `FrameArray`, `Warehouse`, `Tower`.
- Semantic roles tối thiểu: column, rafter, purlin, bracing, base node, frame line và bay.
- Cho phép `DetachFromParametricObject` khi người dùng muốn edit entity con thủ công.

### Gate

- Cùng parameters sinh cùng graph, role keys và stable IDs.
- Đổi warehouse length/bay spacing chỉ tác động entity liên quan, không clear/rebuild
  toàn model một cách mù quáng.
- Invalid regeneration rollback toàn bộ và giữ parametric object cũ.
- Undo regeneration trả cả parameters và entity graph về trạng thái cũ.
- Generator tests bao phủ minimum/maximum values, odd bay count và geometry degeneracy.

### User verification

- Tạo nhà xưởng, đổi chiều dài 60 m -> 72 m, đổi bước khung và thêm giằng; xác nhận
  section/load đã gán và các edit ngoài vùng thay đổi không bị mất.

## Goal 15 — AI Tool Registry + modes + permission policy

### Deliverables

- Tool Registry sinh provider-neutral JSON Schema từ command/query contract.
- Tool handler chỉ gọi Query Service hoặc Command Gateway; không chứa renderer logic.
- Query tools P0:
  - `get_model_summary`, `get_selection`, `get_entities`;
  - `query_entities`, `get_connected_entities`, `get_nearby_nodes`;
  - `get_sections`, `get_materials`, `validate_model`.
- Mutation tools P0:
  - `create_nodes`, `create_members`;
  - `move_nodes`, `update_members`, `change_section`;
  - `delete_entities`, `set_selection`, `hide_entities`, `show_entities`;
  - `execute_transaction`, `preview_transaction`, `undo_last_ai_change`.
- Mọi tool batch-first; không khuyến khích một tool call cho mỗi entity.
- Mode policy:
  - `Inspect`: query-only;
  - `Edit`: selection-scoped update, preview destructive actions;
  - `Modeling`: low-level create/update commands;
  - `Generate`: high-level parametric commands;
  - `Agent`: multi-step plan với step/command/time budget và approval boundaries.
- Destructive/risk classifier dựa trên command semantics và số entity bị ảnh hưởng,
  không dựa vào văn bản LLM tự khai báo.
- Tool response ngắn gọn nhưng có IDs, revision, warning, preview summary và undo token.

### Gate

- Mỗi mutation tool có schema, authorization, idempotency và rollback tests.
- Inspect mode không thể mutate kể cả khi model trả tool call sai.
- Tool Registry chạy với mock provider; core không phụ thuộc một LLM vendor.
- Prompt không rõ unit, target hoặc section trả clarification/preview thay vì tự apply.
- Không tool nào import Three.js hoặc truy cập global WebSocket connection.

### User verification

- Chạy tool harness không có chat UI để tạo hai node, nối member, chọn và đổi section;
  quan sát viewport và undo toàn bộ chuỗi.

## Goal 16 — AI Copilot MVP end-to-end

### Deliverables

- Copilot panel gồm conversation, model selector, mode selector, stop và clear context.
- Server-side orchestration endpoint hỗ trợ streaming text, structured tool calls,
  cancellation, timeout và provider abstraction.
- Context builder chỉ gửi model summary, selection, active units, capabilities và phần
  entity cần thiết; không gửi toàn bộ model lớn vào prompt.
- Conversation state lưu project/model revision; stale context buộc refresh/query trước edit.
- UI hiển thị tool activity ở mức nghiệp vụ: “Tạo 12 node”, “Đổi section 24 cột”,
  không hiển thị raw chain-of-thought.
- Mutation response có preview/diff card, Apply/Reject/Undo và zoom/select created entities.
- P0 natural-language flows:
  - tạo node theo tọa độ và nối member;
  - đọc selection rồi đổi tên/section/material;
  - di chuyển node đang chọn;
  - tìm/chọn/hide/show entity theo property;
  - giải thích validation error và đề xuất command sửa nhưng không tự sửa ngoài mode.
- API key, provider errors và rate limit được xử lý phía server; không log secret/prompt
  chứa dữ liệu nhạy cảm ở mức mặc định.

### Gate

- Bộ 50 prompt P0 Vietnamese + English đạt product success metrics.
- Streaming cancel không commit command chưa hoàn tất.
- Refresh/reconnect không replay mutation đã commit.
- Hai conversation/model session song song không cross-route selection hoặc commands.
- Người dùng luôn nhận được applied change summary và undo action sau mutation.
- AI provider unavailable không ảnh hưởng UI modeling, import/export hoặc analysis.

### User verification

- Hoàn thành một frame đơn giản hoàn toàn qua chat, sau đó chỉnh bằng chuột và tiếp tục
  chat dùng selection hiện tại; kiểm tra undo qua cả hai input path.

## Goal 17 — Fast inspect/select/edit workflows

### Deliverables

- Query DSL deterministic cho filter theo type, group, level, grid, semantic role,
  section, material, name, connectivity, coordinate range và selection.
- Query trả exact count/IDs từ Model Core; LLM chỉ xây query, không tự đếm model.
- Edit workflow có `resolve targets -> preview -> validate -> apply -> summarize`.
- Hỗ trợ relative transformation và pattern edit: move/copy/rotate/mirror/array.
- Batch property edit cho section, material, release, load, support và metadata.
- Reference resolution hiểu `nó`, `các cột vừa tạo`, `frame biên`, `tầng 2` dựa trên
  workspace context/provenance, không dựa vào lịch sử text đơn thuần.
- AI-created entity sets được đặt alias có vòng đời rõ ràng cho các lượt tiếp theo.
- Conflict UX khi người dùng sửa model giữa lúc AI đang lập kế hoạch.

### Gate

- Bộ eval edit bao phủ selection, pronoun/reference, no-match, multi-match và stale revision.
- Query 100.000 entity đạt P95 <= 100 ms cho indexed filters P0.
- Edit 1.000 entity tạo một transaction, một revision và một undo step.
- Không có silent partial match: zero/ambiguous target phải báo rõ hoặc preview.
- Property edits giữ topology, parametric ownership và analysis invalidation đúng phạm vi.

### User verification

- Các kịch bản: “chọn toàn bộ cột tầng 2”, “đổi chúng sang I500”, “dịch các node vừa
  chọn 250 mm theo X”, “ẩn giằng frame biên” cho kết quả đúng và undo được.

## Goal 18 — Fast parametric generation workflows

### Deliverables

- High-level tools: `create_grid`, `create_portal_frame`, `create_frame_array`,
  `create_truss`, `create_warehouse`, `create_tower`, `update_parametric_object`.
- Planner ưu tiên high-level tool; chỉ dùng low-level batch khi không có semantic generator.
- Parameter extraction hỗ trợ Vietnamese engineering vocabulary và explicit unit parsing.
- Missing required parameter workflow: dùng safe default đã publish hoặc hỏi đúng một câu
  ngắn; mọi default xuất hiện trong preview trước apply.
- Preview hiển thị footprint/bounding box, entity counts, sections, loads/supports,
  warnings và estimated rendering/analysis cost.
- Generation provenance liên kết prompt/task -> parametric object -> transaction -> entities.
- Template/version catalogue cho các cấu hình đã duyệt; không hard-code trong system prompt.

### Gate

- Golden prompt suite sinh đúng parameter object và deterministic graph cho mỗi generator.
- Một warehouse chuẩn được tạo trong một high-level tool call và một transaction.
- Câu “đổi chiều dài thành 72 m” gọi update/regenerate, không xóa rồi dựng lại toàn bộ.
- Geometry validation bắt được zero-length member, duplicate/coincident node ngoài tolerance,
  unsupported section và disconnected topology trước commit.
- Generated model có thể export, reload, edit thủ công và gửi OpenSees không mất semantics.

### User verification

- Dựng nhà xưởng 30 × 60 × 8 m, bước khung 6 m; đổi thành 72 m; đổi section cột;
  thêm giằng X frame biên; xác nhận model tree, viewport và analysis snapshot.

## Goal 19 — AI safety, evals, observability và production gate

### Deliverables

- Versioned eval corpus gồm happy path, ambiguity, unit traps, prompt injection trong tên
  entity/document, invalid topology, destructive edits và provider failures.
- Offline mocked-tool eval và online provider eval tách biệt để CI deterministic.
- Tracing theo `requestId -> conversationId -> plan -> toolCall -> commandId -> revision`.
- Metrics: success/failure/clarification rate, latency breakdown, token/cost, rollback,
  approval/rejection và undo-after-AI rate.
- Audit log chứa actor, source, command summary, before/after revision và approval; không
  mặc định lưu chain-of-thought hoặc secret.
- Rate limit, per-project authorization, session isolation, payload limits và timeout budgets.
- Prompt/tool output escaping; tên entity, imported metadata và RAG content luôn là
  untrusted data.
- Kill switch tắt toàn bộ mutation tools trong khi vẫn giữ Inspect và modeling UI.
- Release checklist và incident rollback procedure.

### Gate

- Product success metrics đạt trên eval corpus được khóa trước release candidate.
- Red-team suite không vượt mode policy, approval boundary hoặc project/session scope.
- Tool/provider timeout không giữ transaction lock hoặc model ở trạng thái pending vô hạn.
- Có dashboard/traces đủ để tái hiện một AI mutation từ audit record.
- Manual structural review ký duyệt các generation templates P0.
- Không còn P0/P1 security, data-loss hoặc analysis-correctness issue mở.

### User verification

- Chạy acceptance journey từ model trống đến generate, edit, analyze, undo và reload;
  xuất audit report của toàn bộ journey.

## Goal 20 — Production MCP adapter

Goal này chỉ bắt đầu khi Command Gateway và Goal 19 đã đóng. MCP không có domain logic riêng.

### Deliverables

- MCP server expose cùng Query/Tool Registry, không gửi command qua global browser socket.
- Project/model/session được định danh và authorize rõ; hỗ trợ nhiều client đồng thời.
- Sửa lifecycle client/session, transport URL, dependency packaging và graceful shutdown.
- Capability negotiation, schema version và tool pagination cho catalogue/model query lớn.
- MCP mutation tuân thủ cùng mode policy, approval, revision, idempotency và audit như Copilot.
- Contract tests chứng minh direct Copilot tool và MCP tool tạo cùng command/result semantics.

### Gate

- Hai MCP clients thao tác hai project song song không cross-route dữ liệu.
- Disconnect/retry không duplicate mutation và không để orphan pending request.
- MCP conformance/integration tests pass trên transport được support.
- Tắt MCP không ảnh hưởng built-in Copilot hoặc UI modeling.

## Goal 21 — Optional project-knowledge RAG

Goal này không chặn AI modeling release. Chỉ triển khai khi đã có document corpus và use
case yêu cầu citation rõ ràng.

### Deliverables

- Ingestion có project/tenant ACL, document version, page/section provenance và delete sync.
- Hybrid retrieval: keyword + vector + metadata filter + rerank.
- Citation bắt buộc cho câu trả lời dựa trên specification, catalogue hoặc tiêu chuẩn.
- Model query vẫn gọi Query Service; không index model state để trả exact engineering query.
- Retrieved text là untrusted context và không thể cấp thêm tool permission.
- Eval riêng cho retrieval relevance, citation correctness và stale-document handling.

### Gate

- Không có cross-project retrieval trong ACL tests.
- Citation trỏ đúng document version/page/section và đủ hỗ trợ claim.
- Xóa hoặc supersede document làm index cập nhật trong SLA đã định.
- RAG unavailable không chặn modeling/editing tools.

## Thứ tự triển khai và quy tắc chuyển goal

- Goal 11 phải đóng trước mọi mutation tool AI.
- Goal 12 và 13 là critical path; không làm chat UI production song song để né Command Bus.
- Goal 14 chỉ bắt đầu sau khi Goal 13 đóng và command/transaction contract được khóa.
- Goal 15 dùng mock provider và bắt đầu sau khi Parametric Kernel Goal 14 đóng.
- Goal 16 là mốc AI Copilot MVP đầu tiên có thể phát hành internal alpha.
- Goal 17 và 18 thực hiện tuần tự theo quy tắc một goal active; mọi waiver để chạy
  song song phải ghi rõ owner, file boundary và integration gate.
- Goal 19 là release gate bắt buộc trước external beta.
- Goal 20 và 21 độc lập, chỉ ưu tiên khi có nhu cầu tích hợp ngoài hoặc knowledge corpus.

Mỗi goal khi đóng phải có:

- implementation artifact và ADR nếu có quyết định kiến trúc;
- automated correctness/performance/security tests tương ứng;
- checklist manual đã ký xác nhận;
- benchmark/eval artifact gắn commit SHA;
- danh sách known limits và migration/deprecation còn lại;
- production build xanh, không hạ quality gate để hợp thức hóa lỗi.
