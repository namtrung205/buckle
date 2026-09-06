# Buckle — Project Knowledge

> Tài liệu tổng quan kỹ thuật, được tổng hợp từ mã nguồn tại nhánh `dsh-branch-feat` ngày 2026-09-06. Khi tài liệu và code khác nhau, ưu tiên code đang chạy.

## 1. Dự án giải quyết vấn đề gì?

Buckle là ứng dụng web dựng mô hình và phân tích phần tử hữu hạn (FEA) cho kết cấu khung 3D. Người dùng tạo nút, thanh, tấm, tiết diện, vật liệu, gối và tải trong một viewport Three.js; frontend chuyển mô hình thành JSON theo hệ tọa độ kỹ thuật rồi gửi tới backend. Backend dùng OpenSeesPy để phân tích tĩnh tuyến tính và trả chuyển vị, phản lực, nội lực, ứng suất suy ra và dữ liệu theo trạm để frontend trực quan hóa.

Phạm vi hiện có:

- Dựng và chỉnh sửa mô hình khung/tấm 3D trong trình duyệt.
- Hỗ trợ nút, `elasticBeamColumn`, shell, liên kết đầu thanh, điều kiện biên và tải nút/phân bố/áp lực.
- Thư viện vật liệu đàn hồi và nhiều dạng tiết diện tiêu chuẩn/tự định nghĩa.
- Phân tích tĩnh 3D, 6 bậc tự do mỗi nút.
- Hậu xử lý chuyển vị, phản lực, biểu đồ nội lực và các đại lượng ứng suất.
- Nhập/xuất mô hình JSON, xuất kết quả JSON, ví dụ mẫu và benchmark.
- MCP + WebSocket để một MCP client đọc/chỉnh sửa scene đang mở.
- Đăng ký/đăng nhập qua MongoDB và JWT; phần UI xác thực chưa phải luồng trung tâm của ứng dụng.

## 2. Kiến trúc tổng thể

```text
Người dùng
   │
   ▼
React + MUI + MobX
   │  Model singleton quản lý scene và trạng thái
   ▼
Three.js viewport (hệ Y-up)
   │  exportModelJson / buildModelFromJson
   ▼
JSON dùng chung (hệ kỹ thuật Z-up)
   │  POST /analysis
   ▼
FastAPI ── OpenSeesPy (3D, 6 DOF, static)
   │             │
   │             └─ tính tiết diện, mesh, solve, trích kết quả
   ▼
JSON kết quả ──► PostProcessing / ReactionViz

MCP HTTP ── FastAPI ── WebSocket ──► scene đang mở trong browser
Auth API ── FastAPI ──► MongoDB
```

Hai ứng dụng chính tách rời:

- `frontend/`: SPA React/TypeScript, build bằng Vite, production phục vụ bằng Nginx.
- `backend/`: API FastAPI/Python, engine OpenSeesPy và MCP server.

`docker-compose.yml` ghép bốn service: `frontend`, `backend`, `mongodb`, `tunnel` (Cloudflare Tunnel).

## 3. Cấu trúc thư mục quan trọng

```text
buckle/
├── backend/
│   ├── main.py                 # FastAPI, API analysis, benchmark, WS, mount MCP
│   ├── mcp_tools.py            # MCP tools giao tiếp với browser qua WebSocket
│   ├── database.py             # Kết nối MongoDB
│   ├── auth/                   # Hash mật khẩu, JWT, dependency xác thực
│   ├── routes/auth.py          # /auth/register và /auth/login
│   ├── models/                 # Model người dùng
│   ├── schemas/                # Pydantic schema dùng bởi MCP
│   ├── opensees/
│   │   ├── main.py             # Pipeline phân tích và trích kết quả
│   │   ├── helpers.py          # Điều phối tính đặc trưng tiết diện
│   │   ├── materials/library.py
│   │   └── sections/           # Hình học/catalogue/công thức tiết diện
│   └── tests/                  # API, calculation, section properties, benchmark
├── frontend/
│   ├── src/model/Model.ts      # Aggregate root/singleton của ứng dụng
│   ├── src/model/Elements/     # Node, member, shell
│   ├── src/model/Geometry/     # Grid, work plane, picking, snapping, tools
│   ├── src/model/PostProcessing/
│   ├── src/ui/                 # Ribbon/layout, form model, result, docs
│   ├── src/helpers.ts          # Biên chuyển đổi scene ↔ JSON
│   ├── src/types.ts            # Kiểu dữ liệu frontend
│   ├── src/libraries/          # Vật liệu, tiết diện, hình vẽ tiết diện
│   └── public/examples/        # Mô hình JSON mẫu
├── data/                       # Catalogue tiết diện ASTM/EN/UPN/HEA/angle
├── input_schema.json           # Schema tham khảo cho payload mô hình
├── docker-compose.yml
├── setup.sh / setup.bat        # Cài đặt cục bộ
├── run.bat                     # Chạy trên Windows
└── deploy.sh                   # Hỗ trợ triển khai
```

`_stabileo_ref/` là nguồn tham khảo riêng, không thuộc luồng build/runtime chính của Buckle.

## 4. Frontend

### 4.1 Công nghệ và entry point

- React 18 + TypeScript.
- Vite 8.
- Three.js cho scene 3D và `three-viewport-gizmo` cho view cube.
- MobX/MobX React Lite cho trạng thái quan sát được.
- Material UI cho giao diện, React Toastify cho thông báo.
- Axios gọi API; Chart.js và MUI Data Grid phục vụ kết quả.

Luồng khởi tạo: `src/main.tsx` → `App.tsx` → `pages/viewer/index.tsx` → `Model.getInstance()` → `Layout`. `AppContext` cung cấp `Model` cho cây component.

### 4.2 `Model` là trung tâm hệ thống

`src/model/Model.ts` là singleton/aggregate root, sở hữu gần như toàn bộ trạng thái và vòng đời:

- Three.js scene, WebGL renderer, camera, ánh sáng và view cube.
- Danh sách node, member, shell, section, material, load, boundary condition.
- Grid, level, working plane và các helper hiển thị.
- Selector, snapper, drawing/copy/zoom tools và context menu.
- Post-processing, reaction visualization, console tiến trình và output phân tích.
- Trạng thái UI như dialog, right panel, selection và khóa kết quả.
- WebSocket tới `${VITE_BACKEND_SERVER}/ws/1`.

Sau khi phân tích thành công, model bị khóa để ngăn thay đổi hình học làm kết quả mất đồng bộ. `unlockResults()` xóa toàn bộ kết quả và đưa ứng dụng về chế độ chỉnh sửa.

### 4.3 Hệ phần tử và khả năng dựng hình

- `Node`: điểm hình học và nút FEA.
- `ElasticBeamColumn`: thanh nối hai node, tham chiếu section, local axis và release.
- `Shell`: phần tử mặt với danh sách node, chiều dày và vật liệu.
- `BoundaryCondition`: cờ khóa sáu DOF trên các node mục tiêu.
- `Load`: tải lên node/member/shell tùy `type` và `targets`.
- Generator: warehouse và tower; ngoài ra có copy, move, line drawing, grid/work plane/level.

### 4.4 Quy ước tọa độ — điểm cần giữ tuyệt đối nhất quán

- Scene Three.js dùng **Y-up**.
- JSON dùng chung và OpenSees dùng **Z-up**: X/Y nằm ngang, Z thẳng đứng.
- Chuyển đổi chỉ được thực hiện tại `src/helpers.ts` qua `threeToJson` và `jsonToThree`.
- Tọa độ node, `vecxz` và vector tải phải đổi hệ.
- Các cờ DOF `dx, dy, dz, rx, ry, rz` mang ý nghĩa ngữ nghĩa nên **không hoán đổi**.

Mọi import/export hoặc integration mới nên đi qua `exportModelJson()` và `buildModelFromJson()` thay vì tự chuyển tọa độ ở nơi khác.

### 4.5 Luồng chạy phân tích

1. `TopBar.runAnalysis()` kiểm tra có node, member và section.
2. Xóa visualization cũ, mở dialog tiến trình và gọi `exportModelJson(model)`.
3. Gửi `POST ${VITE_BACKEND_SERVER}/analysis`.
4. Tiến trình backend được broadcast qua WebSocket và ghi vào console frontend.
5. Gán `res.data.output` vào `model.output`.
6. Áp dụng phản lực, khóa model và chuyển sang tab kết quả.

Frontend cho phép tải về cả model JSON và output JSON nguyên dạng.

## 5. Hợp đồng dữ liệu mô hình

Payload gốc do frontend xuất gồm:

| Trường | Nội dung chính |
|---|---|
| `nodes` | `id`, `name`, `x`, `y`, `z` |
| `materials` | `id`, `name`, `E`, `nu` và thuộc tính thiết kế tùy chọn |
| `sections` | discriminated union theo `type`, kích thước, material, properties tùy chọn |
| `members` | `id`, `label`, object `nodei/nodej`, section id, `vecxz`, `release` |
| `shells` | `id`, danh sách node id, `thickness`, material |
| `boundary_conditions` | `id`, `type`, `targets`, sáu cờ DOF |
| `loads` | `id`, `type`, `targets`, vector `value`, `magnitude` tùy loại |
| `metadata` | ngày export, tên model, version |

Các loại tiết diện frontend hiện khai báo: `Rectangular`, `Circular`, `HollowCircular`, `I`, `RectangularHollow`, `Channel`, `Angle`, `Tee`, `IPN`, `UPN`.

Lưu ý quan trọng: Pydantic schema trong `backend/schemas/structural_analysis.py` chủ yếu phục vụ MCP và chưa hoàn toàn trùng payload phân tích thực tế. Ví dụ schema `Member` coi `nodei/nodej` là số, trong khi frontend xuất object chứa cả id và tọa độ. Endpoint `/analysis` nhận `dict` thô, vì vậy contract runtime thực tế nằm ở `frontend/src/helpers.ts` và `backend/opensees/main.py`, chưa được FastAPI xác thực chặt.

## 6. Backend và engine phân tích

### 6.1 API

| Method | Path | Mục đích |
|---|---|---|
| GET | `/health` | Liveness đơn giản, version và timestamp |
| GET | `/ready` | Readiness đơn giản; hiện chưa kiểm tra Mongo/OpenSees |
| GET | `/benchmarks` | Danh sách metadata benchmark |
| GET | `/benchmark/{id}` | Lấy benchmark đầy đủ theo id |
| POST | `/analysis` | Chạy phân tích, trả `{status, output}` |
| POST | `/llm-analysis` | Chạy phân tích và rút gọn thành các bảng cho LLM |
| POST | `/compute-section-properties` | Tính đặc trưng tiết diện; tạm gán thép E=210000, ν=0.3 |
| WS | `/ws/{client_id}` | Tiến trình phân tích và cầu nối MCP/browser |
| POST | `/auth/register` | Tạo người dùng MongoDB |
| POST | `/auth/login` | Cấp bearer JWT |
| HTTP | `/mcp` (mount bởi FastMCP) | MCP streamable HTTP |

CORS hiện cho phép mọi origin. API analysis chưa yêu cầu xác thực.

### 6.2 Pipeline OpenSees

`run_analysis()` được bảo vệ bằng global `threading.Lock`, vì OpenSees dùng state toàn cục/singleton. Chỉ một analysis chạy tại một thời điểm; request chờ lock tối đa 60 giây.

Pipeline:

1. Đọc model và kiểm tra sớm cơ cấu rigid-body.
2. `ops.wipe()` rồi tạo model 3D, 6 DOF/node.
3. Tạo node và geometric transformation/local axes.
4. Tính/tạo section, chia lưới member; tạo beam-column và shell.
5. Áp boundary condition và tải.
6. Chạy static analysis trong 10 load step.
7. Thử solver theo thứ tự `UmfPack` → `SparseSYM` → `BandGenLinLapack` → `FullGeneral`.
8. Dùng `Newton`; khi lỗi thử `KrylovNewton`, rồi `ModifiedNewton + EnergyIncr`.
9. Trích chuyển vị, phản lực, nội lực và station data; tính ứng suất từ section properties.
10. `ops.wipe()` và giải phóng lock.

Đơn vị đáng chú ý:

- Hình học ở mét trong model/OpenSees; code có helper chuyển mm cho tiết diện.
- OpenSees làm việc với N và N·m.
- Tải đầu vào và nội lực/output giao diện chủ yếu dùng kN/kN·m.
- Chuyển vị node trả theo mét; rotation theo radian.
- Ứng suất suy ra trả theo MPa.

Phản lực hiện được lắp ráp thủ công từ cân bằng lực đầu phần tử trừ tải nút, thay vì dựa hoàn toàn vào `ops.reactions()`. Đây là lựa chọn có chủ ý do phiên bản OpenSees từng trả zero cho phản lực built-in.

### 6.3 Kết quả

`output` chính gồm:

- `nodes`: tọa độ và sáu thành phần chuyển vị/quay.
- `members`: mesh con, efforts/stations và `displacement_stations` cho đường biến dạng mượt.
- `reactions`: sáu thành phần phản lực tại node bị giữ.
- `nodal_loads`: sổ nội bộ các tải nút tương đương, dùng cân bằng phản lực.

Mỗi child element được lấy nhiều station để vẽ biểu đồ mượt. Các đại lượng lực chính: `N`, `Vy`, `Vz`, `T`, `My`, `Mz`; ứng suất suy ra gồm `Smax`, `Sabs`, `SvonM`.

## 7. Tiết diện và vật liệu

Backend có hai lớp xử lý:

- `opensees/sections/properties.py`: công thức trực tiếp cho các hình phổ biến.
- `opensees/sections/geometry.py` + `catalogue.py`: phân tích polygon, cung tròn, tiết diện có lỗ/bo/tapered.

Đặc trưng thường trả về: diện tích `A`, mô men quán tính `Iy/Iz`, hằng số xoắn `Jxx`, section modulus, bán kính quán tính và các thông số vật liệu `E/G/nu`.

`data/` chứa catalogue tiết diện ASTM A500, EN 10210, UPN, HEA/HEB/HEM, US channel và equal-leg angle. Frontend cũng có thư viện/catalogue riêng trong `src/libraries/` và `public/isections.json`; cần tránh để hai nguồn dữ liệu trôi khác nhau.

## 8. MCP và WebSocket

FastMCP cung cấp các tool hiện thấy:

- `get_scene_info`
- `add_nodes`
- `add_members`
- `add_bc`
- `add_linear_load`

MCP tool gửi message có UUID qua WebSocket tới browser, rồi polling danh sách message tối đa 10 giây để nhận response cùng id. Kiến trúc hiện dùng biến toàn cục `client_connection` và `messages`, nên thực chất chỉ an toàn cho một browser/client hoạt động; client kết nối sau có thể ghi đè client trước.

## 9. Chạy dự án

### Cục bộ

Yêu cầu theo README: Node.js 18+ và Python 3.12+; MongoDB chỉ cần khi dùng auth.

```bash
# frontend
cd frontend
npm install
npm run dev

# backend (terminal khác)
cd backend
python -m venv venv
# Windows: .\venv\Scripts\activate
# Linux/macOS: source venv/bin/activate
pip install -r requirements.txt
python main.py
```

Frontend Vite mặc định ở `http://localhost:5173`; backend ở `http://localhost:8000`, Swagger tại `/docs`.

Cần đặt `VITE_BACKEND_SERVER`, ví dụ `http://localhost:8000`. Nếu biến này thiếu, WebSocket có fallback localhost nhưng lời gọi Axios trong `TopBar` không có fallback tương đương.

### Docker Compose

```bash
docker compose up --build -d
```

Giá trị mặc định qua `.env.example`:

- Frontend host port `8180` → container 80.
- Backend host port `8101` → container 8000.
- MongoDB chỉ nằm trong internal network.
- Cloudflare tunnel cần `CLOUDFLARE_TUNNEL_TOKEN`.

Frontend Nginx phục vụ SPA và proxy `/api/` cùng `/ws/`; tuy nhiên frontend hiện gọi URL tuyệt đối từ `VITE_BACKEND_SERVER`, còn backend endpoint thật là `/analysis`, không phải `/api/analysis`. Cấu hình domain/tunnel phải route phù hợp cho cả HTTP và WebSocket.

## 10. Kiểm thử và trạng thái kiểm chứng

Đã kiểm chứng ngày 2026-09-06:

- `frontend: npm run build`: **thành công**.
- Backend pytest: **21 passed, 3 failed** trên 24 test.

Ba test lỗi đều thuộc `backend/tests/test_api.py`: chúng gọi endpoint legacy `/api/analysis`, nhận 404, trong khi implementation hiện dùng `/analysis` và payload FEA khác hoàn toàn test tính `surface/volume`. Đây là test cũ, không phản ánh API hiện tại.

Cảnh báo build frontend:

- `src/styles.css` được tham chiếu nhưng không tồn tại lúc build.
- Bundle JS minified khoảng 1.63 MB (gzip khoảng 458 KB), vượt ngưỡng cảnh báo 500 KB; chưa code-split.

`pytest.ini` đặt `--cov-fail-under=80` nhưng không bật `--cov`, nên ngưỡng coverage hiện không thực sự được áp dụng trong lệnh pytest mặc định.

## 11. Rủi ro và nợ kỹ thuật ưu tiên

### Ưu tiên cao

1. **Contract API không được type/validate thống nhất.** `/analysis` nhận `dict`; Pydantic `Model` khác payload frontend. Sai schema thường chỉ phát hiện sâu trong OpenSees và trả 500.
2. **Test API đã lỗi thời.** Bộ test xanh giả định sai nếu chỉ nhìn số test unit; chưa có integration test cho payload mẫu → `/analysis` → output.
3. **Global state giới hạn concurrency.** OpenSees lock chỉ cho một analysis; MCP dùng một WebSocket global; không phù hợp multi-user hoặc scale nhiều worker nếu không thiết kế session/job.
4. **Bề mặt bảo mật rộng.** CORS `*`, analysis/MCP không auth, JWT secret/config cần được quản trị bằng environment, readiness không kiểm tra dependency.
5. **Lỗi cleanup tiềm năng.** Khi analysis ném exception trước bước cleanup bình thường, `finally` nhả lock nhưng không gọi `ops.wipe()`; state OpenSees có thể còn sót đến request sau (dù `init()` request sau sẽ wipe).

### Ưu tiên trung bình

6. **Cấu hình dev cũ.** Middleware FastAPI proxy tới React ở port 3000 và tìm `frontend/build`, trong khi dự án dùng Vite port 5173 và output `dist`; đoạn này nhiều khả năng là di sản CRA.
7. **Thông báo lỗi frontend chưa khớp FastAPI.** UI đọc `error.response.data.message`, trong khi FastAPI thường trả `detail`, làm mất thông báo kỹ thuật hữu ích.
8. **Hai/ba nguồn catalogue và schema.** `data/`, frontend libraries/public JSON và backend catalogue có nguy cơ lệch.
9. **Bundle lớn và chưa lazy-load.** Three.js/MUI/DataGrid/Chart nằm trong bundle chính.
10. **Kiểu load chưa chặt.** Frontend type cho linear load dùng scalar/direction, còn serializer và backend có thể làm việc với vector `value` cùng `magnitude`; cần chuẩn hóa discriminated union theo từng target/type.

### Ưu tiên thấp nhưng nên dọn

- Metadata FastAPI vẫn là tên/description mẫu tiếng Pháp (`SDK Webapp Python`).
- Một số import/comment/debug print không còn cần thiết.
- Nhiều component con chứa `package.json` nhưng không phải package độc lập thực sự.
- `frontend/bash.exe.stackdump` là artefact máy cá nhân, không nên nằm trong repo.
- README nói WebSocket “not used”, nhưng hiện frontend dùng cho analysis progress và MCP.

## 12. Hướng cải tiến đề xuất

1. Chốt một JSON schema versioned duy nhất và sinh type cho cả Python/TypeScript.
2. Đưa `/analysis` sang request/response Pydantic cụ thể, trả lỗi 4xx có đường dẫn field rõ ràng.
3. Thay test legacy bằng golden/integration tests dùng các file trong `public/examples/` và benchmark.
4. Bao `ops.wipe()` trong `finally`; chuyển analysis thành job queue nếu cần nhiều người dùng.
5. Thiết kế MCP/WebSocket theo session id, map connection theo client thay vì biến global.
6. Chuẩn hóa routing production (`/api` hay root), fallback URL và proxy Vite/Nginx.
7. Thêm health/readiness thật cho MongoDB và khả năng khởi tạo OpenSees.
8. Lazy-load UI kết quả/docs/generator để giảm bundle ban đầu.
9. Hợp nhất catalogue section và tự động kiểm tra parity frontend/backend.
10. Bổ sung CI: frontend typecheck/build/lint, backend pytest+coverage, một smoke analysis và Docker build.

## 13. Quy tắc khi sửa code

- Không chuyển Y/Z rải rác; chỉ chuyển tại boundary trong `src/helpers.ts`.
- Mọi thay đổi schema phải cập nhật đồng thời serializer/importer, backend analysis, MCP schema, examples và tests.
- Không chạy OpenSees song song trong cùng process khi còn dùng API stateful toàn cục.
- Khi thay đổi mesh hoặc thứ tự node/element, kiểm tra lại dấu local force, reaction và biểu đồ.
- Khi thêm section mới, bổ sung type frontend, drawing/preview, backend dispatcher/properties, import/export và test số học.
- Khi thêm load mới, định nghĩa rõ đơn vị, frame (global/local), target (node/member/shell) và cách quy đổi về nodal/element load.
- Kết quả phải bị vô hiệu hóa sau mọi thay đổi hình học, vật liệu, tiết diện, support hoặc load.

## 14. Điểm vào nhanh theo loại công việc

| Muốn thay đổi | Bắt đầu đọc từ |
|---|---|
| Layout/ribbon/dialog | `frontend/src/ui/Layout/` |
| Viewport, camera, selection | `frontend/src/model/Model.ts`, `Camera/`, `Geometry/Helpers/` |
| Node/member/shell | `frontend/src/model/Elements/` |
| Import/export JSON | `frontend/src/helpers.ts`, `frontend/src/utils/axis.ts` |
| Chạy analysis từ UI | `frontend/src/ui/Layout/TopBar.tsx` |
| API analysis | `backend/main.py` |
| Solver/mesh/load/result | `backend/opensees/main.py` |
| Tiết diện | `backend/opensees/helpers.py`, `backend/opensees/sections/` |
| Vật liệu | `backend/opensees/materials/library.py`, `frontend/src/libraries/materials.ts` |
| Hậu xử lý | `frontend/src/model/PostProcessing/`, `frontend/src/ui/Results/` |
| MCP automation | `backend/mcp_tools.py`, `frontend/src/model/WebSocket/WebSocket.ts` |
| Auth/MongoDB | `backend/routes/auth.py`, `backend/auth/`, `backend/database.py` |
| Deploy | `docker-compose.yml`, hai `Dockerfile`, `frontend/nginx.conf` |

---

Tài liệu này mô tả trạng thái hiện tại, bao gồm cả các phần legacy và giới hạn đã quan sát được; nó không khẳng định mọi feature đã sẵn sàng cho production hoặc mọi kết quả FEA đã được kiểm chứng theo tiêu chuẩn thiết kế.
