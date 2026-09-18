# Kế hoạch kiến trúc Structural Viewer 3D cho 10.000–100.000+ phần tử

## 1. Mục tiêu và nguyên tắc

Viewer là một structural-analysis/BIM renderer, không phải một scene Three.js thông
thường. Kiến trúc phải tối ưu cho bốn workload độc lập:

1. Hình học mô hình: centerline-only, thin-shell và solid extrude.
2. Kết quả thay đổi theo chiều dài: stress/strain/N/V/M.
3. Tương tác theo entity: hover, selection, hide và filter.
4. Annotation: diagram, symbol, ID và value text.

Nguyên tắc bắt buộc ở quy mô lớn:

- Không dùng `1 entity = 1 Object3D + 1 geometry + 1 material`.
- Domain model không trực tiếp sở hữu object render.
- Geometry topology, entity data, result data và interaction flags là các buffer
  độc lập; thay load case không rebuild geometry.
- Một thay đổi selection/hide không clone material và không rebuild batch.
- `Render Mode` là lựa chọn explicit của người dùng; viewer không tự ý đổi một
  mô hình solid thành thin-shell hoặc centerline khi camera di chuyển.
- `Quality Profile` điều chỉnh tessellation, DPR, shadow, label budget và culling
  theo năng lực máy nhưng không thay đổi `Render Mode` đã chọn.
- FPS, độ đúng kết quả và feature parity là mục tiêu; WebGPU không phải requirement.
- Three.js/WebGL2 là baseline production. WebGPU là backend tùy chọn chỉ được đưa
  vào khi benchmark trên thiết bị mục tiêu chứng minh lợi ích và đủ ổn định.

Three.js hiện mô tả `WebGPURenderer` là experimental và có trường hợp chậm hơn
`WebGLRenderer`. Vì vậy không đặt tiến độ product phụ thuộc WebGPU. Kiến trúc buffer,
shader và renderer adapter phải cho phép nâng cấp backend mà không đổi domain model.

## 2. Performance budget

### Tier A — 10.000 beam

- Orbit: 60 FPS mục tiêu, P95 frame time dưới 20 ms.
- Pointer/hover: phản hồi dưới 50 ms.
- Model render draw calls: dưới 50 ở centerline và dưới 100 ở thin-shell với các
  profile family thông dụng.
- Solid extrude phải đúng chức năng nhưng không phải performance gate chính.
- CPU render submission: dưới 4 ms/frame.
- Không có thao tác O(N) trên pointer move.

### Tier B — 50.000 beam

- Centerline: ít nhất 60 FPS trên GPU desktop trung bình.
- Thin-shell: ít nhất 45 FPS trên GPU desktop trung bình.
- Solid extrude là mode inspect/presentation ít dùng, được tạo lazy và có cảnh báo
  ước lượng memory/triangle trước khi áp dụng trên mô hình lớn.
- GPU memory cho model + result đang active dưới 750 MB.
- Đổi result/load case dưới 150 ms khi dữ liệu đã resident.

### Tier C — 100.000+ beam

- Centerline: mục tiêu 60 FPS; thin-shell: ít nhất 30 FPS trên GPU phù hợp.
- Solid extrude vẫn là mode hợp lệ nhưng không đặt mục tiêu scale 100k trong các
  phase đầu. Không âm thầm downgrade representation khi người dùng đã chọn.
- Draw calls không tăng tuyến tính theo số entity.
- Label hiển thị có budget, mặc định không quá 200 label đồng thời.
- Import, filter và đổi result không khóa main thread quá 50 ms liên tục.

Các con số phải đo bằng production build trên ít nhất hai GPU tier; không dùng FPS
trung bình đơn lẻ để pass gate.

## 3. Kiến trúc đích

```text
Importer/Analysis API
        |
        v
Worker decode + normalize
        |
        v
StructuralSceneDB (SoA TypedArrays, stable entityId)
   |          |             |               |
   v          v             v               v
Geometry   ResultStore   VisibilityStore   SpatialIndex
Library    load cases    selection flags   chunks/BVH
   |          |             |               |
   +----------+-------------+---------------+
                         |
                         v
                  GPU Resource Store
           static buffers / dynamic buffers / LUT
                         |
       +-----------------+------------------+
       v                 v                  v
 Centerline pass   Thin-shell pass    Solid-extrude pass
       |                 |                  |
       +----------- Result/ID shaders -----+
                         |
             Diagram / Symbol / Label passes
```

### 3.1 StructuralSceneDB

Dữ liệu dùng Structure-of-Arrays và stable integer ID. Ví dụ:

```text
beamId[]
startNodeId[] / endNodeId[]
startXYZ[] / endXYZ[]
sectionId[] / materialId[]
localAxisOrGamma[]
resultOffset[] / resultStationCount[]
visibilityFlags[] / selectionFlags[]
```

Node, beam, shell, load và result nằm trong store riêng. React/MobX chỉ observe
summary và UI state; không biến hàng trăm nghìn entity thành observable object.

Mutation dùng command/delta:

- update một dải nhỏ trong typed array;
- đánh dấu dirty range;
- upload đúng dirty range lên GPU;
- update spatial chunk liên quan;
- không rebuild toàn scene.

### 3.2 SectionGeometryLibrary

Section library có hai cấp khóa khác nhau:

```text
thinShellTemplateKey = profileFamily + simplifiedTopology + qualityLevel
solidSignature       = exactDimensions + topology + curveSegments + qualityLevel
```

Thin-shell chuẩn hóa profile thành template tham số hóa:

- loại profile;
- topology version;
- số segment đường cong;
- quality/tessellation level;
- tham số kích thước cơ bản upload theo instance.

Trong thin-shell, H300 và H400 dùng chung một template H nếu shader nhận các kích
thước cơ bản như `h`, `b`, vị trí web/flange và tùy chọn `tw/tf`. Geometry chỉ cần
giúp người dùng nhận ra đúng family/profile và tỷ lệ chính; không dựng fillet, bán
kính lượn, weld hoặc thickness solid chính xác. Vì vậy hàng trăm kích thước H/I có
thể nằm trong cùng một instanced draw thay vì mỗi kích thước thành một geometry.

Ba biểu diễn:

1. **Centerline:** không phụ thuộc tiết diện.
2. **Thin-shell:** representation làm việc chính; dùng các mặt/mid-surface zero hoặc
   near-zero thickness để thể hiện web, flange, perimeter và kích thước tổng thể.
3. **Solid extrude:** tiết diện được extrude dọc toàn bộ beam visible khi người
   dùng chọn mode này.

Không tạo unique `ExtrudeGeometry` cho từng beam. Thin-shell cùng family/topology
dùng template procedural và per-instance dimensions. Custom section dùng simplified
polyline/profile atlas theo chunk. Solid extrude dùng shared geometry theo exact
signature và chỉ được chuẩn bị khi mode đó thực sự được chọn.

### 3.3 Render settings do người dùng điều khiển

Settings có hai trục độc lập:

```text
Render Mode
  centerline-only | thin-shell | solid-extrude

Quality Profile
  low | balanced | high | custom
```

`Render Mode` quyết định representation và luôn do người dùng chọn. Lựa chọn được
lưu theo user/project và giữ nguyên khi zoom, pan hoặc orbit.

| Render Mode | Nội dung render | Trường hợp phù hợp |
| --- | --- | --- |
| `centerline-only` | Trục beam với screen-space width | Máy yếu, mô hình cực lớn, thao tác dựng mô hình |
| `thin-shell` | Profile template tham số hóa, đúng family và kích thước cơ bản | Chế độ làm việc chính |
| `solid-extrude` | Surface extrude chi tiết hơn theo exact section | Kiểm tra hình học/presentation, ít dùng |

`Quality Profile` có thể được viewer đề xuất sau một benchmark ngắn, nhưng người
dùng có quyền override. Profile điều khiển:

- số segment cho Pipe/CHS và section cong;
- tessellation theo chiều dài;
- device pixel ratio/render scale;
- antialias, shadow và post-processing;
- chunk size và culling strategy;
- label/symbol budget;
- mức resident của result/load case.

Viewer được phép cull đối tượng ngoài frustum, bỏ mặt quá nhỏ hoặc giảm tessellation
bên trong representation đã chọn. Viewer không được tự chuyển `solid-extrude ->
thin-shell -> centerline-only`. Nếu dự báo vượt GPU memory, UI cảnh báo và đề xuất
mode/profile khác; người dùng xác nhận lựa chọn.

Chuyển mode chỉ đổi render pass/GPU resources đang active. `StructuralSceneDB`,
entity ID, selection, visibility và result buffers được giữ nguyên; không import
hoặc dựng lại domain model.

### 3.4 Hardware profile và recommendation

Lần đầu chạy, viewer thu thập capability và có thể chạy micro-benchmark ngắn:

- backend thực tế; WebGL2 extensions/limits và WebGPU capability nếu có;
- texture/buffer limits, vertex attributes và precision;
- GPU memory pressure gián tiếp qua allocation test có giới hạn;
- throughput centerline và thin-shell trên fixture chuẩn; solid-extrude chỉ đo để
  đưa cảnh báo khi người dùng bật;
- viewport, DPR và chi phí picking/readback.

Kết quả chỉ dùng để đề xuất `Render Mode` và `Quality Profile` ban đầu. Settings UI
phải hiển thị mode hiện tại, recommendation và ước lượng chi phí. Người dùng có thể
chọn mode khác bất kỳ lúc nào; viewer ghi nhớ override và không tự đổi lại trong
phiên làm việc.

Backend không phải setting người dùng thông thường. Viewer mặc định dùng backend đã
được chứng nhận ổn định cho browser/GPU đó. WebGPU có thể nằm sau feature flag hoặc
advanced setting trong giai đoạn thử nghiệm; nếu lỗi hoặc chậm hơn thì quay về
WebGL2 mà không làm mất chức năng.

## 4. Render pipeline

### 4.1 Centerline pass

- Một procedural line/quad primitive được instance theo beam.
- Shader đọc start/end/local axis/entity flags.
- Screen-space width ổn định.
- Đây là mode nhẹ nhất người dùng có thể chọn và là fallback cho thiết bị không đủ
  capability, nhưng mọi fallback phải được thông báo thay vì diễn ra âm thầm.
- Mục tiêu: 100.000 beam trong một số ít draw calls theo chunk/layer.

Không dùng `Line2` hoặc một line object cho mỗi member.

### 4.2 Thin-shell pass

Đây là pass làm việc mặc định. Giai đoạn đầu:

- group theo `thinShellTemplateKey + materialClass`;
- một normalized template cho mỗi family/topology: H/I, U/C, L, Box, Pipe...;
- per-instance buffer chứa `h`, `b`, `tw`, `tf`, diameter hoặc các basic dimensions
  tương ứng; shader biến đổi template theo các tham số này;
- `InstancedMesh`/custom instanced geometry cho topology giống nhau dù kích thước
  profile khác nhau;
- chunk khoảng 512–4.096 beam để frustum culling và partial update hiệu quả;
- transform beam được dựng từ start/end/gamma trên GPU hoặc upload dạng compact.

Mức hình học tối thiểu:

- H/I: ba mid-surface plate gồm hai flange và một web;
- U/C: web và hai flange;
- L: hai leg surfaces;
- Box: bốn perimeter surfaces;
- Pipe: polygon tube/ring với segment count theo Quality Profile;
- Custom: simplified closed/open profile polyline, không yêu cầu CAD B-rep.

Mục tiêu là nhận diện đúng profile và các tỷ lệ `depth/width/leg/diameter`; thickness
có thể được biểu diễn bằng metadata, edge hoặc tham số shading thay vì volume thật.

#### 4.2.1 Orientation và góc xoay mặt cắt

I và H có cùng simplified topology nên dùng chung template H. H đứng, H nằm ngang
hoặc xoay góc bất kỳ không tạo geometry/batch mới. Mỗi beam instance lưu:

```text
start/end hoặc start + length
local-frame quaternion (hoặc localX/localY/localZ)
gamma nếu chưa được bake vào quaternion
profile dimensions
insertion/cardinal offset
mirror/flip flags nếu có
```

Template dùng tọa độ local `(sectionX, sectionY, u)`, với `u = 0..1` dọc beam.
Shader biến đổi:

```text
sectionX' =  sectionX*cos(gamma) + sectionY*sin(gamma)
sectionY' = -sectionX*sin(gamma) + sectionY*cos(gamma)

worldPosition = start
              + localX * (sectionX' + insertionX)
              + localY * (sectionY' + insertionY)
              + localZ * (u * length)
```

Dấu của công thức phải theo đúng convention local 2/local 3 của solver; công thức
trên chỉ biểu diễn một hệ tay phải nhất quán. H xoay ngang đơn giản là `gamma = 90°`.
Draw call không tăng vì mọi góc xoay nằm trong cùng instance buffer.

Khuyến nghị production là CPU tính local-frame quaternion một lần khi start/end,
reference vector hoặc gamma thay đổi, rồi GPU áp quaternion lên vertex/normal. Cách
này ổn định hơn việc mỗi vertex tự dựng basis từ global-up, đặc biệt với beam đứng,
và giảm phép tính lặp trong vertex shader. Quaternion là render data, không phải
Object3D riêng cho beam.

Các trường hợp cần dữ liệu thêm nhưng vẫn có thể dùng cùng template:

- insertion/cardinal point: cộng offset trong mặt phẳng tiết diện;
- end offsets: nội suy offset từ đầu I đến đầu J theo `u`;
- tapered H/I cùng topology: nội suy dimensions đầu I/J theo `u`;
- U/L/asymmetric profile: gamma vẫn xử lý rotation, còn mirror/flip dùng flag riêng;
- reversed I/J: local-frame convention phải deterministic để result V2/V3/M2/M3
  không bị đảo dấu ngoài ý muốn.

Không dùng negative-scale tùy tiện để mirror profile vì có thể đảo winding và normal.
Shader nên reflect local coordinate theo flag và biến đổi normal tương ứng. Curved
beam là topology/path khác: cần polyline/spline stations và moving frame, không dùng
straight-beam transform đơn giản này.

Giai đoạn Tier C nếu WebGL2 instancing/chunking chưa đạt budget:

- profile vertices/segments nằm trong texture/buffer atlas;
- instance record trỏ tới profile offset/count;
- vertex shader/TSL dựng vị trí dọc beam;
- WebGL2 dùng instanced attributes/data texture và CPU/worker visible list;
- WebGPU có thể dùng storage buffer, compute visible list và indirect draw nếu
  benchmark chứng minh cần thiết và ổn định đủ cho production.

`BatchedMesh` phù hợp làm bước chuyển tiếp cho heterogeneous static meshes, nhưng
thin-shell parametric instancing theo family sẽ hiệu quả hơn việc tạo geometry riêng
cho H300, H400, H500... và đưa tất cả vào batch.

### 4.3 Solid-extrude pass

- Đây là secondary/inspection mode, không phải render path mặc định.
- Khi người dùng chọn, render solid extrude cho toàn bộ beam visible, không chỉ
  selected/hovered hoặc beam gần camera.
- Các beam cùng `solidSignature` dùng shared indexed geometry và
  instancing; tuyệt đối không tạo `ExtrudeGeometry` riêng cho từng beam.
- Với custom profile entropy cao, dùng profile atlas + vertex pulling hoặc batch
  theo topology/chunk.
- Frustum/visibility culling vẫn hoạt động; beam ngoài viewport không submit draw.
- Selected/hovered chỉ dùng overlay/highlight, không phải điều kiện để có solid.
- GPU resource chỉ lazy-create lần đầu người dùng chọn mode và cache theo budget;
  không chiếm memory hoặc làm chậm import khi đang dùng centerline/thin-shell.
- UI hiển thị dự báo triangle/GPU memory và tiến độ chuẩn bị mode. Nếu vượt hard
  device limit thì báo rõ nguyên nhân và đề xuất profile/mode nhẹ hơn.

### 4.4 Shell, load và support

- Shell: indexed geometry theo spatial chunk; result là attribute/storage buffer.
- Arrow/support symbol: instanced primitive hoặc SDF/icon atlas.
- Không dùng nhiều `ArrowHelper`, cone/cylinder/material riêng lẻ.

## 5. Result và diagram không rebuild model

### 5.1 ResultStore

Result được tách khỏi geometry:

```text
caseDirectory[caseId] -> GPU buffer handle/version
beamResultMeta[beamId] -> offset + stationCount
stationS[]             -> normalized 0..1
resultValues[]         -> N,V2,V3,M2,M3,T,stress,...
```

Mỗi beam có thể có 9/17/33 station hoặc adaptive station. Dùng packed Float32 trước;
sau khi có sai số cho phép mới đánh giá Float16/quantization.

Để shader không phải linear-scan một mảng station dài cho từng vertex, chọn một
trong ba layout sau theo benchmark:

- resample về số station cố định cho từng result tier;
- batch beam theo `stationCount`;
- giữ variable-length data với `offset/count` và binary search giới hạn.

Phương án fixed station count đơn giản và SIMD-friendly nhất; variable station chỉ
dùng khi sai số resample hoặc memory budget không chấp nhận được.

Đổi load case thực hiện bằng đổi buffer/binding hoặc upload result buffer mới, không
thay geometry, không tạo material mới và không duyệt Object3D.

### 5.2 Stress/strain color map

- Vertex shader lấy tọa độ dọc `s` của vertex.
- Tìm hai station gần nhất và interpolate result.
- Chuyển scalar thành màu qua 1D LUT texture.
- Min/max/range là uniform.
- Nếu cần stress theo vị trí trên tiết diện, GPU tính từ N/M và tọa độ local của
  profile; không bake vertex color cho mỗi lần đổi case.

Một scalar `stress[beam][station]` chỉ mô tả stress dọc một fiber/điểm quy ước. Nếu
cần contour trên toàn tiết diện, buffer phải chứa nội lực/coefficient đủ để shader
tính theo tọa độ local `(y,z)`, hoặc chứa stress theo `station × profileVertex`.

### 5.3 N/V/M diagram

- Diagram là procedural ribbon/tube pass, không phải một mesh riêng cho mỗi beam.
- Topology station cố định hoặc lấy từ result metadata.
- Vertex shader sinh hai phía ribbon từ local axis và result scale.
- Chỉ render beam visible hoặc được filter/selected.
- Value labels là pass riêng, không gắn DOM label cho mọi station.

## 6. Selection, hover, hide và filter

### 6.1 GPU ID picking

CPU raycast qua 100.000 beam không phải đường chính.

- Render ID/entity index vào offscreen integer/color target.
- Click đọc một pixel; hover đọc vùng nhỏ theo tần suất tối đa khoảng 30 Hz.
- Readback có pipeline 1–2 frame để tránh block GPU.
- ID resolve qua bảng stable `renderIndex -> entityId`.
- `instanceId` chỉ là địa chỉ render tạm thời trong một batch, có thể đổi sau
  filter/rebuild; không được dùng làm domain `beamId`.
- WebGL2 fallback dùng centerline proxy + spatial BVH/chunk, không duyệt scene.

### 6.2 Highlight và visibility

- `selectionFlags`, `hoverId`, `visibilityFlags`, `filterMask` là GPU buffer/uniform.
- Một `selectedId` uniform chỉ đủ cho single-selection. Multi-select dùng bitset,
  byte/uint flag buffer hoặc compact selected-index buffer tùy mật độ selection.
- Shader quyết định màu/highlight/discard/compaction.
- Không đổi `material.color` từng entity.
- Không clone material khi chọn.
- Hide/filter lớn kích hoạt visible-list rebuild bằng worker/compute, không toggle
  hàng trăm nghìn `Object3D.visible`.

### 6.3 Spatial index

- CPU BVH hoặc uniform grid theo chunk cho fit-view, window selection và fallback.
- Frustum cull theo chunk trước; cull instance bằng compute ở Tier C.
- Window selection dùng projected bounds/compute, trả về ID list, không phụ thuộc
  `SelectionBox` duyệt Object3D.

## 7. Text, symbol và annotation

- CSS2D chỉ dùng cho số lượng rất nhỏ như tooltip/panel.
- ID/value hàng loạt dùng glyph atlas + instanced SDF/MSDF quad hoặc canvas overlay.
- Label scheduler có priority: selected > hovered > extrema > visible important.
- Declutter theo screen grid; giới hạn mặc định 100–200 label.
- Symbol reaction/load/support dùng atlas/instanced primitive.
- Khi camera đang orbit, có thể giảm label budget hoặc tạm ẩn value phụ.

## 8. Render scheduling và threading

- Demand rendering khi idle; continuous rendering chỉ khi camera/animation/streaming.
- Camera update, culling, label layout và GPU upload chạy theo dirty flags.
- Import/parse/normalize/result decode chạy Web Worker.
- Worker trả transferable `ArrayBuffer`; tránh clone object graph lớn.
- Upload chia frame budget để không tạo long task.
- Telemetry tách CPU update, culling, upload, submit, GPU frame, picking và labels.

## 9. Backend strategy

Tạo interface renderer-domain, không để domain phụ thuộc trực tiếp Three objects:

```text
StructuralRenderer
  initialize(capabilities)
  uploadModel(sceneDB)
  applyModelDelta(delta)
  bindResult(caseId, component)
  setRenderMode(centerline-only | thin-shell | solid-extrude)
  setQualityProfile(low | balanced | high | custom)
  setVisibility(flags/delta)
  pick(screenPoint)
  render(frameState)
  dispose()
```

Implementations:

- `WebGL2StructuralRenderer` — implementation production đầu tiên: Three.js
  `WebGLRenderer`, `InstancedMesh`/custom instanced geometry, GLSL shader, data
  texture/attributes, render-target ID picking và CPU/worker culling/BVH.
- `WebGPUStructuralRenderer` — implementation tùy chọn về sau: `three/webgpu`,
  NodeMaterial/TSL, storage buffers, compute và indirect draw khi thực sự có lợi.

Hai implementation dùng chung `StructuralSceneDB`, result layout và interaction
contract. Không chuyển toàn ứng dụng sang WebGPU trong một commit. Backend WebGPU
chỉ được promote sau feature flag khi đạt visual parity, functional parity và
performance tốt hơn hoặc giải quyết được giới hạn cụ thể của WebGL2.

## 10. Custom shader strategy

Custom shader rất phù hợp và là phần cốt lõi của kiến trúc; không cần WebGPU để có
data-driven rendering. Implementation theo backend:

- `WebGLRenderer`: GLSL `ShaderMaterial`/`RawShaderMaterial`, instanced attributes
  và data textures. Đây là đường production đầu tiên.
- `WebGPURenderer`: ưu tiên `NodeMaterial + TSL`. Three.js không hỗ trợ
  `ShaderMaterial`, `RawShaderMaterial` và `onBeforeCompile()` theo cách cũ trong
  WebGPU renderer.
- Direct WGSL/custom pipeline chỉ dùng sau khi TSL được benchmark là blocker. Mọi
  low-level WebGPU code phải nằm sau adapter riêng; không để domain model phụ thuộc
  API nội bộ không ổn định của Three.js.

### 10.1 Những việc nên đưa vào shader

| Chức năng | Input GPU | Shader thực hiện |
| --- | --- | --- |
| Beam transform | start/end/gamma/profile index | dựng local frame và world position |
| Profile | family template + per-instance dimensions hoặc atlas | dựng thin-shell; solid dùng exact signature khi bật |
| Result | result offset/count + station buffer | nội suy giá trị tại `u = 0..1` |
| Color map | scalar + min/max + LUT | normalize và lấy màu |
| Diagram | N/V/M samples + scale/local axis | dịch procedural ribbon vertices |
| Highlight | hover render index + selection flags | blend outline/emissive/color |
| Visibility | filter/visibility flags | cull/compact trước draw hoặc discard có kiểm soát |
| ID picking | stable render index | ghi ID vào picking target |

CPU không tạo lại geometry khi đổi result, min/max, diagram component, selection
hoặc filter. CPU chỉ cập nhật uniform, texture/buffer binding hoặc dirty range.
Trong WebGL2, result/flags lớn có thể được đóng gói vào floating-point/integer data
texture; trong WebGPU chúng có thể chuyển sang storage buffer mà giữ nguyên schema.

### 10.2 Beam geometry shader model

Một geometry template dùng tọa độ chuẩn:

```text
local vertex = (profileY, profileZ, u)
u            = 0..1 dọc beam

GPU đọc instance:
start, end, gamma, profileId, renderIndex

world vertex = start + axisX*profileY + axisY*profileZ + axisZ*(u*length)
```

Với H/I/U/L/Box/Pipe có topology xác định, thin-shell dùng template + profile
parameters. H300/H400 khác kích thước nhưng không cần khác geometry: shader scale/
offset các web/flange surfaces từ per-instance dimensions. Chỉ solid-extrude hoặc
custom topology mới cần exact signature/profile atlas với
`vertexOffset/indexOffset/count` hay batch riêng.

### 10.3 Result lookup shader model

```text
renderIndex
  -> resultMeta[offset, stationCount]
  -> locate interval chứa u
  -> interpolate physical value
  -> normalize(value, min, max)
  -> sample color LUT
```

Không lưu RGB theo beam/station. LUT có thể đổi palette và uniform có thể đổi range
mà không upload lại result. Cần benchmark fixed-count/resampled stations với
variable-count lookup; không giả định một layout phù hợp mọi result set.

### 10.4 Diagram shader model

Centerline và diagram có thể dùng shared beam/result buffers, nhưng nên là render
pass/material riêng để bật/tắt độc lập. Một strip template theo `u` sinh hai vertex
mỗi station; shader offset theo local axis và result component đang chọn. N/V2/V3/
M2/M3 dùng cùng pipeline, chỉ đổi component index, direction rule và scale uniform.

### 10.5 Draw-call expectation thực tế

`20 profile families/topologies -> khoảng 5–20 draw calls` là hợp lý trong thin-shell
nếu chúng có render state tương thích. Số section definitions như H300/H400 không
nhất thiết làm tăng draw call khi dùng parametric family template. Nhưng
draw calls còn nhân theo:

- layer/chunk và material transparency;
- shadow/depth/picking pass;
- quality/topology variants;
- diagram/selection/edge passes.

Vì vậy mục tiêu `10–40 model draw calls` cho 10k beam là hợp lý ở color pass;
`5–15` chỉ nên là stretch goal cho profile atlas/vertex pulling/indirect draw, không
là acceptance gate ban đầu. Telemetry phải báo draw call theo pass và tổng frame.

### 10.6 Ranh giới trách nhiệm CPU/GPU

CPU quản lý domain data, commands, undo/redo, worker jobs, spatial index và
interaction state. GPU quản lý bulk rendering, result interpolation và color
mapping. Culling/compaction có thể chạy bằng CPU/worker trên WebGL2; chỉ chuyển sang
compute khi profiling chứng minh cần. Ở 100k, không tiếp tục dựa vào Three.js
raycast qua Object3D; cả WebGL2 lẫn WebGPU đều có thể dùng offscreen ID pass.

### 10.7 Migration rule

Không viết procedural WebGPU toàn bộ ngay từ đầu là quyết định đúng. Thứ tự an toàn:

1. SceneDB/buffer contract độc lập backend.
2. Instanced centerline và section templates.
3. GLSL/WebGL2 result color + selection.
4. GLSL/WebGL2 procedural diagram.
5. GPU ID picking.
6. Đạt product feature parity và performance gate trên WebGL2.
7. WebGPU/TSL spike trên cùng fixture.
8. Compute/indirect/direct WGSL chỉ khi profiling chứng minh cần thiết và phải có
   fallback.

Repo hiện dùng Three.js `0.173` nhưng `@types/three` `0.165`; trước mọi renderer
refactor cần đồng bộ version, pin chính xác và khóa bằng visual/performance tests.

## 11. Functional parity theo MIDAS Civil/ETABS/SAP2000

FPS không được đánh đổi bằng việc bỏ hành vi kỹ thuật. Mọi renderer backend và mọi
Render Mode dùng cùng domain IDs, selection, result semantics và unit conversion.

### 11.1 Model/display

- Orthographic/perspective, plan/elevation/3D và named views.
- Centerline-only và parametric thin-shell là hai workflow chính; solid-extrude là
  inspection mode theo setting người dùng.
- Local axes, end releases, offsets/insertion point và orientation/gamma.
- Node, frame, shell, material/section và property inspection.
- Grid, level/story, group, layer và coordinate systems.
- Hide/show/isolate, filter, clipping plane/section box và transparency.
- ID/property label có density control nhưng selected entity luôn truy cập được.

### 11.2 Loads và symbols

- Nodal load, distributed/point member load, pressure và support/reaction symbol.
- Local/global load direction và đúng hệ trục hiển thị.
- Load pattern, load case, combination và envelope selection.
- Moving-load/temperature/prestress chỉ thêm sau khi schema result/load tổng quát
  đã ổn định, không hard-code vào renderer.

### 11.3 Results

- Deformed/undeformed shape và animation scale.
- N/V2/V3/T/M2/M3 diagrams thay đổi theo station.
- Stress/strain contour với legend, range, unit và palette.
- Reaction/support force và extrema/min-max labels.
- Load case/combo/envelope switching không rebuild model geometry.
- Probe tại beam/station, tooltip và selected-value panel.
- Modal/buckling shapes dùng chung displacement/result buffer contract.

### 11.4 Interaction

- Hover, click, Ctrl multi-select, window/crossing selection.
- Filter/select theo type, property, section, material, group, story và result range.
- Selection giữ ổn định khi đổi Render Mode/result/backend.
- Edit/delete/copy/hide thao tác theo domain `entityId`, không theo `instanceId`.
- Context menu, focus/fit selection và undo/redo command contract.

### 11.5 Acceptance matrix

Mỗi feature quan trọng có test theo ma trận:

```text
Feature
  × Render Mode (3)
  × Backend được support
  × Projection (perspective/orthographic)
  × Model size tier
  × Result state (none/case/combo/envelope)
```

Golden image chỉ kiểm tra hình ảnh; test domain-ID mapping kiểm tra selection/edit;
numeric fixture kiểm tra nội suy result/unit/legend. Performance test không thay thế
correctness test và ngược lại.

## 12. Lộ trình triển khai

### Phase 0 — Contract và benchmark (1–2 tuần)

- Chốt fixture 1k/10k/50k/100k.
- Ma trận section entropy: ít loại, hỗn hợp, nhiều custom.
- Result fixture 9/17/33 station.
- Đo CPU phase, GPU time, draw calls, memory và interaction latency.
- Golden screenshots cho centerline-only/thin-shell/solid-extrude/stress/diagram.
- Benchmark từng tổ hợp `Render Mode × Quality Profile × GPU tier`; không gộp kết
  quả ba representation thành một chỉ số.
- Lập feature-parity checklist và numeric/golden fixtures cho các chức năng mục
  11; phân hạng P0/P1/P2 thay vì cố sao chép toàn bộ sản phẩm desktop cùng lúc.

Gate: benchmark chạy lặp lại và có pass/fail budget; chưa tối ưu thêm scene cũ.

### Phase 1 — StructuralSceneDB + worker import (2–4 tuần)

- Stable entity IDs và render indices.
- SoA typed arrays, delta/dirty range API.
- Import worker và transferable buffers.
- Adapter từ domain model hiện tại sang SceneDB.

Gate: import 100k không tạo 100k MobX entity/Object3D và main-thread long task đạt
budget đã chốt.

### Phase 2 — Centerline renderer (2–3 tuần)

- Procedural/instanced centerlines theo chunk.
- Frustum culling, visibility flags, selection color.
- Hoàn thiện WebGL2 trước; renderer contract không khóa đường nâng cấp WebGPU.

Gate: 100k centerlines đạt Tier C và picking ID chính xác.

### Phase 3 — Render Mode settings + parametric thin-shell (4–6 tuần)

- Thêm setting explicit `centerline-only | thin-shell | solid-extrude` và quality
  profile độc lập.
- Thin-shell family template và per-instance basic dimensions.
- Exact solid signature/library ở mức tối thiểu để giữ compatibility với mode ít dùng.
- I/H/U/L/Box/Pipe trước, custom sau.
- Thin-shell instancing theo family/topology/quality/chunk.
- Simplified profile-atlas spike cho custom thin-shell.
- Solid-extrude lazy creation; không allocate khi mode chưa được chọn.
- Chuyển mode không rebuild SceneDB/result/selection.

Gate: 10k mixed sections đạt Tier A ở centerline/thin-shell; 50k centerline/thin-shell
đạt Tier B. H300/H400 cùng family không tạo thêm geometry/draw call. Solid extrude
đúng chức năng, lazy-load và có cost report; chưa phải performance gate 50k–100k.

### Phase 4 — GPU picking và interaction state (2–3 tuần)

- ID pass, asynchronous readback, hover throttle.
- Click, Ctrl select, window select, hide/show/filter.
- Selection/visibility buffers và domain ID mapping.

Gate: không có O(N) pointer path; selection regression suite pass.

### Phase 5 — Result shader pipeline (3–5 tuần)

- ResultStore và load-case buffer residency.
- Station interpolation + LUT color map.
- Stress/strain và N/V/M component switching.
- Partial/streaming result upload.

Gate: đổi result không rebuild geometry và đạt latency budget.

### Phase 6 — Diagram, symbol và label renderer (3–4 tuần)

- Procedural N/V/M ribbons.
- Instanced load/reaction/support symbol.
- SDF text, priority scheduler và declutter.

Gate: diagram thay đổi liên tục theo chiều dài; label count không phá frame budget.

### Phase 7 — Production hardening và solid-extrude compatibility (3–5 tuần)

- Hoàn thiện solid-extrude inspection mode và cache theo exact signature.
- Chỉ scale-up solid-extrude nếu usage telemetry/customer requirement chứng minh cần.
- Quality profiles và hardware recommendation benchmark.
- Context/device loss recovery.
- GPU memory pressure policy.
- Backend/capability telemetry và WebGPU spike tùy kết quả benchmark.
- Cross-browser visual/performance regression.

Gate: toàn bộ feature matrix và performance tiers đạt trên thiết bị mục tiêu.

## 13. Thứ tự ưu tiên kỹ thuật

1. SceneDB/data-oriented architecture.
2. Centerline renderer 100k.
3. Stable ID picking và visibility buffer.
4. Render Mode setting và parametric thin-shell instancing.
5. Result buffer + shader interpolation.
6. Diagram procedural.
7. Label virtualization.
8. Solid-extrude compatibility/lazy cache ở mức đủ cho inspection workflow.
9. Đánh giá scale-up solid/WebGPU/compute/indirect draw chỉ khi telemetry chứng minh cần.

Không bắt đầu bằng compute shader hoặc tối ưu premature cho full solid model.
Centerline và parametric thin-shell phải nhận phần lớn ngân sách phát triển/performance.
Solid-extrude vẫn có đúng chức năng nhưng được lazy-build sau SceneDB và section
sharing, vì đây là workflow ít dùng.

## 14. Các quyết định cần khóa trước khi code Phase 1

- Basic dimensions và mức nhận diện hình học tối thiểu của thin-shell cho từng
  profile family; xác định rõ tham số nào chỉ hiển thị metadata thay vì geometry.
- Số station phổ biến/tối đa và cách nội suy result.
- Browser/GPU tối thiểu cho WebGL2 production baseline.
- Danh sách feature P0 bắt buộc để đạt trải nghiệm kỹ thuật tương đương workflow
  chính của MIDAS Civil/ETABS/SAP2000.
- Target FPS theo GPU tier thực tế của khách hàng.
- Mode mặc định và quality profile được đề xuất cho từng GPU tier; recommendation
  không được override lựa chọn explicit của người dùng.
- Custom section có được chỉnh sửa realtime hay chỉ import/read-only.
- Maximum resident load cases và memory budget.
- Sai số cho phép nếu quantize result/profile data.

## 15. Nguồn kỹ thuật chính

- [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)
- [Three.js WebGLRenderer và asynchronous render-target readback](https://threejs.org/docs/pages/WebGLRenderer.html)
- [Three.js WebGL instancing performance example](https://threejs.org/examples/webgl_instancing_performance.html)
- [Three.js WebGPURenderer guide](https://threejs.org/manual/en/webgpurenderer)
- [Three.js TSL specification](https://threejs.org/docs/TSL.html)
- [Three.js WebGPU instancing example](https://threejs.org/examples/webgpu_instance_mesh.html)
- [Three.js WebGPU storage-buffer example](https://threejs.org/examples/webgpu_storage_buffer.html)
- [Three.js IndirectStorageBufferAttribute](https://threejs.org/docs/pages/IndirectStorageBufferAttribute.html)
- [WebGPU render/indirect operations](https://www.w3.org/TR/webgpu/)
