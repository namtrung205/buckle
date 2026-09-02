# Buckle — Đặc tả tái xây dựng UI-first

## 1. Mục đích và ranh giới

Tái xây dựng frontend Buckle bằng **React + TypeScript**, lấy UX/UI và các luồng làm việc của `_stabileo_ref/web` làm tham chiếu. Frontend hiện tại trong `frontend/` không là nền tảng để mở rộng; chỉ có thể đọc để đối chiếu payload OpenSees và các asset thật sự cần thiết.

Ứng dụng mới phải cho kỹ sư thực hiện được vòng lặp:

```text
Tạo/chỉnh mô hình → gán property → gán điều kiện biên & tải
→ chạy phân tích → đọc kết quả → chỉnh mô hình → chạy lại
```

### Ngoài phạm vi MVP

- Chuyển mã Svelte từng file sang JSX một cách máy móc.
- Chuyển Rust/WASM solver của Stableo.
- Education mode, AI drawer, blog/landing, thiết kế bê tông/thép theo tiêu chuẩn, CAD/IFC import và report PDF hoàn chỉnh.
- Modal, buckling, nonlinear, time-history, response spectrum và load-combination UI cho đến khi backend OpenSees có contract và bài test tương ứng.

### Ràng buộc pháp lý

`_stabileo_ref` là AGPL-3.0. Nếu copy hoặc chuyển đổi trực tiếp mã nguồn, sản phẩm phân phối phải tuân thủ AGPL. Nếu không muốn chịu ràng buộc này, chỉ dùng nó làm tham chiếu hành vi/UX; tự viết component, CSS, icon và logic mới.

## 2. Kết quả cần đạt

### M0 — Ứng dụng UI độc lập

- Có app React mới, build và chạy độc lập với backend.
- Có layout làm việc giống Stableo Basic: header/ribbon, canvas trung tâm, panel ngữ cảnh bên phải, status bar, floating tools.
- Dùng fixture cục bộ để trình diễn đầy đủ UI, không chờ API.

### M1 — Model editor 3D dùng được

- Tạo, chọn, sửa, xóa node và member trên viewport.
- Gán material, section, support, nodal/distributed load qua panel và bảng dữ liệu.
- Có grid, snap, orbit/pan/zoom, select box, labels, undo/redo và phím tắt chính.
- Model được lưu ở domain store, hoàn toàn độc lập renderer và API.

### M2 — Tích hợp phân tích OpenSees

- Gọi backend qua một adapter duy nhất.
- Báo tiến trình, trạng thái bận, lỗi validation và lỗi solver rõ ràng.
- Model đổi sau solve làm invalid kết quả; UI không được hiển thị kết quả cũ như dữ liệu hiện hành.

### M3 — Đọc kết quả cấu kiện

- Xem deformed shape, reactions, N/Vy/Vz/T/My/Mz, colour scale và station inspection.
- Có bảng nodes/members/results có thể chọn hai chiều với viewport.
- Benchmark chuẩn chạy qua UI, có kết quả regression lưu lại.

### M4 — Sản phẩm MVP ổn định

- Project JSON versioned, IndexedDB autosave, import/export JSON.
- Responsive shell tối thiểu, accessibility cơ bản, tests cho model, adapter và các luồng quan trọng.

## 3. Định nghĩa MVP giao diện

MVP chỉ hỗ trợ **một workspace 3D elastic frame**. 2D được xem là một model 3D có `y = 0` hoặc preset camera, không tạo solver/UI 2D riêng ở giai đoạn đầu.

### 3.1 Shell desktop

```text
┌──────────────────────────────────────────────────────────────────────┐
│ App bar: Project | Undo/Redo | Save/Open | Examples | Solve | Settings│
├──────────────────────────────────────────────────────────────────────┤
│ Ribbon: View | Data | Draw | Conditions | Properties | Analyse | Results│
├──────────┬───────────────────────────────────────────────┬───────────┤
│ Floating │              Three.js viewport                 │ Context   │
│ tools    │ grid, model, labels, diagrams, selection        │ panel     │
│          │                                                 │ data/edit │
├──────────┴───────────────────────────────────────────────┴───────────┤
│ Status: tool | selection | coordinates | units | solve state          │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.2 Ribbon và hành vi

| Nhóm | Lệnh MVP | Hành vi |
|---|---|---|
| View | Select configuration, 2D/3D camera, grid, labels | Không mở modal trừ Settings; luôn giữ canvas ổn định. |
| Data | Nodes, Members, Materials, Sections, Supports, Loads | Mở tab tương ứng ở context panel. |
| Draw | Node, Member | Arm tool; click canvas tạo/chọn thực thể. |
| Conditions | Support, Load | Arm tool và hiển thị options contextual. |
| Properties | Materials, Sections | Mở catalog/editor trong context panel. |
| Analyse | Solve | Nếu model invalid: hiển thị errors; nếu hợp lệ: bắt đầu solve và mở Results. |
| Results | Deformed, N, Vy, Vz, T, My, Mz, Reactions | Disabled trước solve; sau solve chọn biểu diễn trên canvas. |

Quy tắc UX bắt buộc:

1. Command có thể áp dụng nhưng chưa đủ điều kiện thì **disabled + tooltip giải thích**, không biến mất.
2. Tool tạo mô hình và result view loại trừ nhau. Khi arm Node/Member/Support/Load, đóng result overlay để tránh hiểu nhầm thao tác.
3. Mọi model mutation tăng `modelRevision`, làm result chuyển thành `stale` ngay lập tức.
4. Solve chỉ publish kết quả nếu revision khi response trả về vẫn bằng revision lúc gửi request.
5. Panel đóng/mở không làm camera/canvas nhảy ngang; canvas luôn là vùng làm việc chính.

### 3.3 Context panel

Panel bên phải gồm header, close button, tab strip khi cần và vùng body scroll độc lập.

- **Data:** bảng Nodes, Members, Materials, Sections, Supports, Loads.
- **Selection:** thuộc tính và thao tác cho thực thể đã chọn.
- **Tool options:** loại gối, vector tải, giá trị tải, snapping/axis placement.
- **Results:** lựa chọn biểu đồ, scale biến dạng, legend, min/max, inspection station.
- **Settings:** units, grid, labels, rendering mode.

Chỉ render panel đang mở. Không để một form editor có state local là nguồn dữ liệu chính; commit phải đi qua store command.

## 4. Kiến trúc frontend

Tạo app mới trong thư mục đề xuất `web/` hoặc `frontend-next/`. Chỉ đổi tên thành `frontend/` sau khi MVP đạt M4 để không làm gián đoạn deployment hiện tại.

```text
web/
  src/
    app/              # bootstrap, routes, providers, application shell
    design-system/    # tokens, Button, Input, Dialog, DataGrid, Icon
    features/
      workspace/      # ribbon, status, panels, shortcuts
      viewport/       # Three.js scene, picking, controls, overlays
      model/          # model commands, editors, tables
      analysis/       # solve UI, results panels and render state
      projects/       # fixtures, JSON import/export, autosave
    domain/
      model.ts        # normalized entities and invariants
      analysis.ts     # request/result canonical types
      units.ts
      commands.ts
    stores/           # app state; one store boundary per concern
    services/
      analysis-api.ts # HTTP/WebSocket transport only
      opensees-adapter.ts
      persistence.ts
    test/
```

### 4.1 Khuyến nghị kỹ thuật

- React 18+ / TypeScript strict / Vite.
- Three.js trực tiếp, không buộc React Three Fiber: renderer là imperative subsystem, React chỉ cung cấp state và host element.
- Zustand hoặc Redux Toolkit cho state global. Chọn một, không trộn MobX/signals/store tự chế.
- TanStack Table cho data table nếu cần sorting/filtering; không dùng grid nặng cho MVP nếu table đơn giản đủ.
- CSS variables/design tokens + CSS Modules hoặc vanilla CSS. Tránh bắt đầu bằng MUI nếu mục tiêu là tái tạo mật độ UI/UX Stableo.
- Vitest + Testing Library cho logic/component; Playwright cho workflow canvas/solve sau M2.

### 4.2 Domain model chuẩn

Domain model là contract nội bộ của frontend; không mirror trực tiếp JSON của OpenSees.

```ts
type Id = number;

interface Node { id: Id; label: string; x: number; y: number; z: number; }
interface Member {
  id: Id; label: string; nodeI: Id; nodeJ: Id;
  sectionId: Id; materialId: Id; vecXZ?: [number, number, number];
  release?: 'fixed-fixed' | 'fixed-pinned' | 'pinned-fixed' | 'pinned-pinned';
}
interface Material { id: Id; name: string; EPa: number; nu: number; rhoKgM3?: number; }
interface Section {
  id: Id; name: string; kind: SectionKind; materialId: Id;
  dimensionsMm?: Record<string, number>;
  properties?: { areaM2: number; iyM4: number; izM4: number; jM4?: number };
}
interface Support {
  id: Id; nodeIds: Id[]; kind: 'fixed' | 'pinned' | 'roller' | 'elastic' | 'custom';
  dof: [boolean, boolean, boolean, boolean, boolean, boolean];
  stiffness?: [number, number, number, number, number, number];
}
interface Load {
  id: Id; name: string; kind: 'nodal' | 'linear' | 'pressure'; targetIds: Id[];
  vectorKN?: [number, number, number]; magnitudeKNM2?: number;
}
```

Invariants bắt buộc trước khi solve:

- ID duy nhất; member không có zero length.
- Member tham chiếu node/section/material tồn tại.
- Support/load target tồn tại và đúng loại entity.
- Các đơn vị domain cố định: m, N/Pa, kg/m³; UI chỉ là lớp chuyển đổi. Payload backend chuyển tải kN khi contract yêu cầu.
- Không để `nodeI` khi thì là ID, khi thì là node object.

### 4.3 Store phân lớp

| Store | Nội dung | Không được chứa |
|---|---|---|
| `modelStore` | normalized model, commands, selection, revision, history | Three.js objects, HTTP state |
| `uiStore` | active tool/panel, preferences, dialogs, toasts | domain entity canonical |
| `analysisStore` | idle/validating/running/succeeded/failed/stale, results, request id | form draft |
| `viewportStore` | camera preference, grid/display toggles | source-of-truth model |

Mọi mutation model phải là command (`addNode`, `moveNode`, `addMember`, `deleteSelection`, …), để undo/redo, validation và stale-result logic đi qua cùng một đường.

## 5. Viewport và interaction

### 5.1 Renderer responsibilities

Renderer nhận một scene projection từ domain store và quản lý:

- scene/camera/renderer/lights/grid;
- render layers: model, labels, loads, supports, result overlays, selection;
- raycast/picking và box selection;
- orbit/pan/zoom;
- disposal toàn bộ geometry/material/texture khi entity bị xóa hoặc component unmount.

Renderer không trực tiếp sửa `modelStore`. Nó phát interaction event có semantic rõ ràng, ví dụ `onNodePicked(id)`, `onCanvasPointPicked(position)`, `onMemberPicked(id)`; feature/tool controller quyết định command nào sẽ chạy.

### 5.2 Tool state machine

```text
idle/select
  ├─ Node tool    → preview point → click → add node
  ├─ Member tool  → pick first node → preview segment → pick second node → add member
  ├─ Support tool → pick node → add support using current support options
  └─ Load tool    → pick node/member → add load using current load options
```

- `Esc` hủy trạng thái đang dở của tool, không xóa model.
- `Delete/Backspace` xóa selection sau khi resolve dependencies và hiện confirmation nếu xóa kéo theo member/load/support.
- Nhấn chuột phải không làm mất selection; mở context menu theo entity.
- Snap resolution: grid trước, endpoint node sau, projection-to-member chỉ thêm sau khi có test rõ ràng.

### 5.3 Acceptance criteria M1

- Người dùng tạo một beam 2 node, nối bằng member, đổi tiết diện, đặt hai gối và nodal load mà không sửa JSON.
- Click vào row bảng làm highlight entity trong canvas; click canvas highlight đúng row.
- Undo/redo trả model đúng trạng thái trước/sau ít nhất cho add, move, delete và edit properties.
- Tạo member tới node không tồn tại, member zero-length và tải vào target sai bị chặn bằng error dễ hiểu.

## 6. Analysis adapter và API contract

### 6.1 Quy tắc

React component chỉ gọi:

```ts
analysisService.solve(modelSnapshot, { signal, onProgress })
```

Không component nào gọi `fetch('/analysis')` trực tiếp hoặc biết `member.nodei` backend cần object đầy đủ.

### 6.2 Adapter responsibilities

`opensees-adapter.ts` phải:

1. Validate `ModelSnapshot`.
2. Đổi `Member.nodeI/nodeJ` ID thành node object theo runtime backend hiện tại.
3. Đổi material/section units theo OpenSees contract đã chốt.
4. Chuyển supports và loads đúng field naming.
5. Gắn `requestId`, `modelRevision`, `schemaVersion`.
6. Chuyển `response.output` về `AnalysisResult` chuẩn.
7. Không nuốt lỗi HTTP/solver; trả `AnalysisError` có `kind`, `message`, `details`, `requestId`.

### 6.3 Contract backend cần hoàn thành trước M2

Backend hiện có các bất nhất schema. Cần tạo endpoint mới `POST /api/v1/analysis`; giữ `/analysis` cũ chỉ để tương thích tạm thời.

```ts
interface AnalysisRequest {
  schemaVersion: '1.0';
  requestId: string;
  model: OpenSeesModelPayload;
}
interface AnalysisResponse {
  requestId: string;
  status: 'succeeded' | 'failed';
  result?: AnalysisResult;
  diagnostics: Diagnostic[];
}
```

`AnalysisResult` tối thiểu:

- displacement sáu bậc tự do tại model nodes;
- reactions tại support nodes;
- member metadata: length, local axis, mesh;
- ordered stations cho N, Vy, Vz, T, My, Mz;
- deformed displacement stations;
- đơn vị được khai báo explicit ở response;
- warnings/errors solver ở dạng có cấu trúc.

Không expose random mesh child IDs như identity chính của UI. UI chỉ định danh member gốc và station `t` từ 0 đến 1.

### 6.4 Progress và concurrency

- Khi `running`, ribbon Solve disabled; canvas vẫn cho phép orbit/pan nhưng cấm model mutation hoặc yêu cầu user cancel.
- WebSocket chỉ là enhancement. Nếu không kết nối được, HTTP solve vẫn hoạt động với spinner/cancel state.
- Do OpenSees dùng singleton/lock, backend trả `503 ANALYSIS_BUSY` có retry guidance.
- Client dùng `AbortController`; backend có thể chưa dừng OpenSees ngay, nên kết quả đã abort không được publish.

### 6.5 Acceptance criteria M2

- Gửi benchmark `SSLL03` từ UI, nhận progress và result.
- Response cũ hơn `modelRevision` bị discard.
- 400 validation, 422 schema, 500 solver failure, 503 busy đều có thông báo riêng và không làm mất model.
- Unit conversion có unit test với ít nhất rectangular section, nodal load và distributed load.

## 7. Hiển thị kết quả

### MVP result modes

| Mode | Dữ liệu cần | Hiển thị |
|---|---|---|
| Deformed | displacement stations | wireframe gốc mờ + hình biến dạng; scale chỉnh được |
| Reactions | support reactions | arrow/vector + bảng |
| N/Vy/Vz | member force stations | diagram có sign convention và legend |
| T/My/Mz | member force stations | diagram có sign convention và legend |
| Station inspect | member id + `t` | tooltip/panel với giá trị tại station |

Yêu cầu hiển thị:

- Legend phải ghi quantity, unit, min/max và colour/sign convention.
- Deformed scale không được sửa dữ liệu vật lý; chỉ là display factor.
- Một result mode tại một thời điểm; `None` trả canvas về model view.
- Khi result stale, xóa overlay hoặc hiện badge stale, không để số cũ trông như current.

## 8. Persistence, fixtures và import/export

### MVP

- `ProjectFile` JSON với `format: 'buckle-project'`, `version`, `createdAt`, `updatedAt`, `model`, `uiPreferences` tối thiểu.
- Autosave debounced xuống IndexedDB; khôi phục có banner xác nhận.
- Save/open JSON file từ máy người dùng.
- Fixtures local: cantilever, simply-supported beam, portal frame, `SSLL03`.

### Sau MVP

- CSV/XLSX result export.
- DXF import/export, IFC import.
- Multi-tab projects và server persistence.

## 9. Kế hoạch sprint theo thứ tự UI-first

### Sprint A — Foundation và visual shell

Deliverables:

- Scaffold React app mới, tokens, global reset, layout shell.
- Ribbon, panel, status bar, floating tool bar bằng fixture local.
- Design snapshot desktop 1440px và responsive 1024px.

Done khi: `npm run build`, `npm run test` chạy; người dùng có thể mở/đóng panel và chuyển tool mà không có backend.

### Sprint B — Domain/store và data UI

Deliverables:

- Canonical model, ID generator, fixtures, commands, history, selection.
- Data tables và property editor cho toàn bộ entity MVP.
- Validation synchronous và toast/error presentation.

Done khi: mọi thao tác data table có thể được undo/redo và model serialize/deserialize losslessly.

### Sprint C — Three.js model editor

Deliverables:

- Grid, camera controls, model render, labels, picking, snap.
- Node/member/support/load tools và selection box.
- Bi-directional selection table/canvas.

Done khi: acceptance criteria M1 đạt trong browser, với Playwright smoke test cho portal frame.

### Sprint D — Backend contract và adapter

Deliverables:

- Versioned FastAPI endpoint + Pydantic request/result models.
- Adapter frontend, HTTP client, progress/error lifecycle.
- Backend contract tests với fixtures.

Done khi: `SSLL03` chạy end-to-end và result normalized được snapshot test.

### Sprint E — Results viewport

Deliverables:

- Deformed shape, reaction vectors, diagrams, legend, station inspection.
- Results panel/table và stale result policy.

Done khi: số tại station/reaction table khớp response backend; screenshot test bảo vệ các result modes.

### Sprint F — Persistence và hardening

Deliverables:

- Project JSON, autosave, recovery, keyboard shortcuts, error boundaries.
- Accessibility pass cho button, inputs, dialogs, focus handling.
- CI build/typecheck/unit/Playwright smoke.

Done khi: một project có thể save → refresh → restore → solve lại không thay đổi model payload.

## 10. Definition of Done toàn dự án MVP

- Không import Rust/WASM hoặc phụ thuộc solver Stableo.
- Không có API mapping trong React component.
- Không còn ambiguity về field names hay units giữa frontend/backend.
- Một model mẫu có thể build, edit, solve, inspect result, save, reload và solve lại.
- Lỗi calculation không làm crash app hoặc mất dữ liệu người dùng.
- UI có parity theo **workflow Basic** của Stableo, không cam kết parity toàn bộ Basic/Pro/Education feature set.
- Có test regression cho model mapper, unit conversion, stale-result guard và ít nhất hai workflow browser.

## 11. Quyết định cần chốt trước Sprint A

1. Sản phẩm có chấp nhận AGPL hay chỉ lấy Stableo làm UX reference và tự viết toàn bộ code/UI?
2. Chọn tên thư mục mới: `web/` hay `frontend-next/`.
3. MVP bắt đầu bằng single 3D workspace như đặc tả này, hay cần 2D-first.
4. Có cần giữ MongoDB/auth trong MVP hay chỉ lưu local trước.

Mặc định đề xuất: UX reference-only (tránh copy AGPL), `web/`, 3D-first, local-only persistence; auth/server project storage là phase sau.
