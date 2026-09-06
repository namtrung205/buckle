# Viewer3D Performance Improvement Plan

> Kế hoạch tuần tự để tối ưu mô hình lớn. Mỗi goal phải được kiểm chứng bằng cùng một fixture và cùng điều kiện máy/browser trước khi chuyển goal tiếp theo.

## Nguyên tắc đo

- Dùng production build, không dùng React development build để kết luận FPS.
- Giữ nguyên kích thước viewport, browser zoom, màn hình, GPU và mô hình giữa các lần đo.
- Chờ 5 giây sau khi load model rồi mới ghi số liệu.
- Ghi cả trạng thái đứng yên, orbit liên tục và rê chuột liên tục.
- Ưu tiên frame time P95/P99; FPS trung bình có thể che mất giật khung hình.
- Mỗi kịch bản đo ba lần, lấy median.

## Bộ chỉ số

- FPS.
- Frame time trung bình, P95 và P99.
- Draw calls và triangles/frame.
- Số geometry, texture và object trong scene.
- Số pickable và raycast time P95.
- Số CSS2D label.
- Thời gian load/import model và mức sử dụng bộ nhớ nên ghi thêm bằng Chrome DevTools.

## Goal 1 — Baseline telemetry

Phạm vi:

- Mở rộng tùy chọn `Show FPS` thành performance HUD.
- Thu thập frame time, renderer statistics, scene size, label count và raycast time.
- Thiết lập protocol benchmark lặp lại.

Điều kiện hoàn thành:

- Frontend build thành công.
- HUD không gây thay đổi đáng kể khi bật/tắt.
- Người dùng cung cấp baseline của mô hình lớn theo mẫu bên dưới.

### Benchmark tự động

1. Mở mô hình cần đo.
2. Vào `Settings → View` và bật `Show FPS`.
3. Nhấn `Run benchmark` trên HUD và không tương tác với viewer trong lúc chạy.
4. Harness tự chạy warmup, idle, orbit và pointer sweep trong khoảng 11 giây.
5. Nhấn `Copy result` để lấy JSON. Báo cáo cũng được in giữa hai marker
   `BUCKLE VIEWER BENCHMARK START/END` trong DevTools Console.

Luôn chạy production build và dùng cùng viewport/máy/browser khi so sánh hai phiên bản.

## Goal 2 — CPU interaction và render-loop

Phạm vi:

- Cache danh sách pickable thay vì duyệt scene trên mỗi pointer event.
- Raycast tối đa một lần mỗi animation frame.
- Không hover-raycast khi orbit, pan, zoom hoặc kéo selection box.
- Chỉ cập nhật node scale/depth range/projection khi camera hoặc model thay đổi.
- Áp dụng demand rendering cho trạng thái idle nếu không phá các animation hiện có.

Điều kiện hoàn thành:

- Raycast P95 giảm ít nhất 60% trên fixture lớn.
- Orbit và pointermove không còn frame spike lớn do scene traversal.
- Không regression selection, snapping, drawing, view cube và result hover.

## Goal 3 — Geometry và resource sharing

Phạm vi:

- Giảm extrusion steps của thanh thẳng.
- Dùng chung material theo vai trò hiển thị.
- Dùng geometry node nhẹ hơn trước bước instancing.
- Chỉ tạo/render member edges theo visibility/LOD cần thiết.
- Dọn đúng ownership của shared resource để không dispose nhầm.

Điều kiện hoàn thành:

- Triangles giảm rõ rệt so với baseline.
- Geometry/material allocation giảm.
- Hình dạng và orientation của mọi section không thay đổi về ý nghĩa.

## Goal 4 — Batching và instancing

Phạm vi:

- Node chuyển sang `InstancedMesh` hoặc `Points`.
- Centerline gom thành buffer/batch.
- Solid member gom theo section/material/chunk phù hợp.
- Load arrows và support symbols dùng instancing/batching khi khả thi.
- Duy trì ánh xạ `entityId ↔ instanceId` cho selection và editing.

Điều kiện hoàn thành:

- Draw calls không còn tăng tuyến tính theo số node/member cùng loại.
- Mô hình benchmark đạt mục tiêu FPS đã thống nhất mà selection vẫn chính xác.
- Import, delete, edit, copy và result coloring không regression.

## Goal 5 — LOD, label virtualization và regression benchmark

Phạm vi:

- LOD: centerline ở xa, solid ở gần, edge chỉ khi cần.
- Chỉ render node/label theo zoom, viewport, selection và hover.
- Spatial chunks/frustum culling cho mô hình rất lớn.
- Tạo benchmark fixture và performance budget dùng cho các review sau.

Điều kiện hoàn thành:

- FPS ổn định trên fixture mục tiêu.
- P95/P99 không vượt performance budget.
- Có checklist hoặc test tự động phát hiện draw-call/triangle regression.

## Mẫu ghi baseline

```text
Thiết bị/GPU:
Browser và phiên bản:
Độ phân giải viewport:
Tên/kích thước model:
Nodes / Members / Shells / Loads:

Idle:
  FPS / AVG / P95 / P99:
  DRAW / TRI / OBJ / GEO / TEX:

Orbit liên tục 10 giây:
  FPS / AVG / P95 / P99:

Rê chuột liên tục 10 giây:
  FPS / AVG / P95 / P99:
  PICK / RAY last / RAY P95:

Labels bật:
  LABEL:
  FPS / P95 / P99:

Ghi chú hiện tượng:
```

## Thứ tự quyết định sau mỗi goal

Sau mỗi vòng, so sánh với baseline:

1. Nếu raycast chiếm phần lớn frame budget, ưu tiên spatial acceleration/proxy picking.
2. Nếu draw calls cao nhưng triangles vừa phải, ưu tiên batching/instancing.
3. Nếu triangles cao, ưu tiên geometry simplification và LOD.
4. Nếu label count làm FPS giảm mạnh, ưu tiên virtualization hoặc canvas/SDF labels.
5. Nếu idle tốt nhưng orbit kém, bottleneck nằm ở render submission/GPU hơn là event handling.

## Nhật ký benchmark fixture lớn

Fixture: 765 nodes, 1.380 members, 702 shells, 2.184 labels; Firefox/Windows,
Radeon R9 200 Series, DPR 1. Số FPS dưới đây là phase idle.

| Mốc | Draw calls | Triangles | Geometries | Scene objects | FPS idle | Frame avg |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 39.070 | 2.242.500 | 6.888 | 55.872 | 1,8 | 559 ms |
| Batch load | 6.318 | 2.695.560 | 5.615 | 9.193 | 5,9 | 169 ms |
| Geometry nhẹ/shared | 6.318 | 742.200 | 4.851 | 9.193 | 6,3 | 159 ms |
| Batch member edge/centerline | 3.560 | 742.200 | 2.093 | 6.435 | 8,0 | 125 ms |

Lưu ý: baseline và mốc batch load dùng viewport 977×765; hai mốc sau dùng
1640×765. So sánh draw/triangle/object là trực tiếp, còn FPS giữa hai nhóm chỉ mang
tính tham khảo.

### Checkpoint đang chờ xác minh

- Member solid dùng `BatchedMesh` theo layer.
- Shell faces dùng một `BatchedMesh`.
- Node markers dùng một `InstancedMesh` cho mỗi layer; instance matrix đồng bộ theo
  camera để giữ kích thước 3 px trên màn hình.
- Mesh member gốc vẫn là proxy picking/box-selection để giữ nguyên luồng edit/delete.
- Hover/selection đồng bộ màu sang instance.
- Có mapping hai chiều giữa entity ID và `instanceId`/`batchId`; proxy cũ tiếp tục
  phục vụ raycast trong checkpoint này để không làm thay đổi selection semantics.
- Stress solid tự tắt batch và dùng mesh gốc để giữ màu theo vertex.
- Production build đã thành công; cần benchmark JSON và kiểm tra tương tác trên fixture lớn.
