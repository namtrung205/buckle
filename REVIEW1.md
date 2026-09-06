# REVIEW 1 — Đánh giá kiến trúc và khả năng phát triển thành product

> Baseline review tại nhánh `dsh-branch-feat`, ngày 2026-09-06. Tài liệu này dùng làm mốc để đánh giá các vòng cải tiến tiếp theo.

## 1. Kết luận điều hành

Buckle có nền tảng tốt để phát triển thành một sản phẩm kỹ thuật chuyên biệt hoặc MVP thương mại, nhưng kiến trúc hiện tại chưa phù hợp để vận hành như SaaS đa người dùng ở quy mô lớn.

Điểm mạnh nằm ở trải nghiệm mô hình hóa 3D và chuỗi phân tích đã chạy xuyên suốt. Điểm nghẽn lớn nhất là contract dữ liệu chưa thống nhất, backend stateful, năng lực xử lý đồng thời thấp, thiếu persistence cho project và chưa có verification suite đủ mạnh cho phần mềm kỹ thuật kết cấu.

Khuyến nghị định vị ban đầu:

- Công cụ phân tích sơ bộ cho kỹ sư kết cấu.
- Công cụ thiết kế/kiểm tra frame đơn giản.
- Công cụ giáo dục và đào tạo FEA.
- Web modeler có AI copilot và khả năng chia sẻ/review.
- Internal tool cho công ty tư vấn trước khi mở rộng thành SaaS.

Không nên định vị ngay là sản phẩm thay thế SAP2000, ETABS hoặc Robot Structural Analysis.

## 2. Chấm điểm hiện trạng

| Khía cạnh | Điểm | Nhận xét |
|---|---:|---|
| Nền tảng sản phẩm | 7/10 | Đã có workflow model → analysis → results tương đối hoàn chỉnh |
| Kiến trúc frontend | 6/10 | Nhiều tính năng nhưng `Model` đang trở thành God Object |
| Kiến trúc backend | 5/10 | Dễ hiểu nhưng API và engine ghép khá chặt |
| Khả năng mở rộng tải | 3/10 | OpenSees singleton và global lock giới hạn một analysis/process |
| Khả năng mở rộng tính năng | 6/10 | Có hệ element/section rõ nhưng contract chưa thống nhất |
| Độ tin cậy kỹ thuật | 4/10 | Thiếu benchmark và regression suite đủ mạnh |
| Bảo mật và multi-tenancy | 3/10 | Auth cơ bản; analysis và MCP chưa được bảo vệ |
| Khả năng triển khai | 6/10 | Đã có Docker, Nginx, MongoDB và Cloudflare Tunnel |
| Product readiness tổng thể | 5/10 | Phù hợp private beta; chưa phù hợp production thương mại diện rộng |

## 3. Điểm mạnh của kiến trúc

### 3.1 Chuỗi giá trị sản phẩm đã hiện hữu

Buckle không chỉ là proof of concept về solver. Dự án đã có workflow mang dáng dấp sản phẩm:

1. Dựng mô hình trực quan.
2. Gán tiết diện, vật liệu, gối và tải.
3. Chạy phân tích.
4. Theo dõi tiến trình.
5. Xem chuyển vị, phản lực, nội lực và ứng suất.
6. Nhập/xuất dữ liệu.

Đây là lợi thế lớn so với một dự án chỉ có solver hoặc chỉ có giao diện mô phỏng.

### 3.2 Boundary tọa độ được xác định tốt

Quy ước hiện tại:

- Three.js dùng Y-up.
- JSON kỹ thuật và OpenSees dùng Z-up.
- Chỉ chuyển đổi tại `exportModelJson()` và `buildModelFromJson()`.

Đây là quyết định kiến trúc đúng. Nếu giữ kỷ luật này, dự án có thể bổ sung IFC, DXF, API bên thứ ba hoặc renderer mới mà không làm nhiễm logic tọa độ trên toàn hệ thống.

### 3.3 Frontend có domain model thực sự

Node, member, shell, support, load, section và material đã được biểu diễn như các đối tượng domain, không chỉ là Three.js mesh rời rạc. Đây là nền tảng cho:

- Undo/redo.
- Lịch sử chỉnh sửa.
- Validation.
- Collaboration.
- Import/export.
- Plugin hoặc command system.
- Tự động sinh mô hình.

### 3.4 Solver pipeline có tính thực dụng

Backend đã xử lý nhiều vấn đề thường chỉ xuất hiện khi chạy mô hình thật:

- Khóa singleton của OpenSees.
- Kiểm tra rigid-body mechanism.
- Chia nhiều load step.
- Fallback solver và algorithm.
- Trích dữ liệu theo station.
- Nội suy đường biến dạng.
- Lắp ráp phản lực thay thế.
- Dọn state sau phân tích thành công.

### 3.5 AI/MCP có thể tạo khác biệt sản phẩm

MCP kết nối trực tiếp tới scene mở ra các workflow như:

- Tạo khung theo mô tả tự nhiên.
- Gán gối hoặc tải hàng loạt.
- Kiểm tra bất ổn của mô hình.
- Giải thích nguyên nhân chuyển vị lớn.
- Đề xuất và áp dụng thay đổi tiết diện.

Nếu được thiết kế lại theo command/session model, đây có thể là khác biệt rõ ràng so với phần mềm FEA truyền thống.

## 4. Các giới hạn kiến trúc quan trọng

### 4.1 `Model` frontend đang quá lớn

`frontend/src/model/Model.ts` đồng thời quản lý:

- Dữ liệu kết cấu.
- Three.js scene và renderer.
- Camera và navigation.
- Selection, snapping và tools.
- Trạng thái dialog/panel.
- WebSocket.
- Results và visualization.
- Visibility và lock/unlock.
- Một phần business rule.

Hệ quả:

- Khó test ngoài browser.
- Dễ phát sinh side effect.
- Khó triển khai undo/redo và collaboration.
- Khó thay renderer.
- Thay đổi UI có thể ảnh hưởng domain state.

Kiến trúc nên tiến dần tới:

```text
ProjectStore
├── StructuralModelStore
├── AnalysisStore
├── SelectionStore
├── UiStore
├── ViewportService
├── CommandBus
└── ApiClient
```

Three.js object không nên là nguồn dữ liệu chuẩn. Nguồn chuẩn nên là model thuần dữ liệu; scene là projection của model đó.

### 4.2 Backend chưa có lớp application/domain rõ ràng

`backend/main.py` đang chứa HTTP, WebSocket, proxy frontend, benchmark, analysis, LLM formatting, section endpoint và MCP mount.

`backend/opensees/main.py` cũng gom nhiều trách nhiệm:

- Validation.
- Stability check.
- Model construction.
- Meshing.
- Loading.
- Solving.
- Result extraction.
- Stress derivation.

Ranh giới đề xuất:

```text
API layer
    ↓
Application services
    ↓
Domain model + validation
    ↓
Analysis job abstraction
    ↓
OpenSees adapter
    ↓
Result normalization
```

OpenSees nên là một adapter, không phải domain trung tâm. Điều này cho phép bổ sung solver khác, worker riêng hoặc engine native về sau.

### 4.3 Contract dữ liệu chưa thống nhất

Hiện có nhiều nguồn mô tả dữ liệu:

- `frontend/src/types.ts`
- `frontend/src/helpers.ts`
- `input_schema.json`
- Pydantic schema
- Logic đọc `dict` trong OpenSees
- Các JSON example và benchmark

Một số điểm không trùng nhau:

- `Member.nodei/nodej`: Pydantic schema dùng ID, frontend xuất object.
- Linear load: có nơi dùng scalar/direction, nơi dùng vector/magnitude.
- Tên section type chưa hoàn toàn thống nhất.
- `/analysis` nhận `dict`, nên lỗi schema thường chỉ xuất hiện sâu trong solver.

Nên tạo `ModelSchema v1` duy nhất và version hóa:

```json
{
  "schemaVersion": "1.0",
  "units": {
    "length": "m",
    "force": "kN"
  },
  "coordinateSystem": "Z_UP_RIGHT_HANDED",
  "model": {}
}
```

Sau đó sinh TypeScript type và JSON Schema từ model chuẩn, hoặc ít nhất kiểm tra parity tự động trong CI.

### 4.4 Analysis không scale theo request

OpenSeesPy dùng global state; backend hiện có một lock cho toàn process. Hệ quả:

- Một worker chỉ giải một bài toán tại một thời điểm.
- Request thứ hai phải chờ.
- Sau 60 giây có thể nhận 503.
- Analysis dài giữ kết nối HTTP mở.
- Scale bằng nhiều Uvicorn worker chưa giải quyết được job lifecycle, timeout và resource control.

Kiến trúc product nên chuyển sang job:

```text
POST /analysis-jobs
        │
        ▼
Job queue
        │
        ├── OpenSees worker 1
        ├── OpenSees worker 2
        └── OpenSees worker N
        │
        ▼
Result store
```

Mỗi worker nên chạy process độc lập, xử lý một job rồi wipe hoặc được recycle. Client nhận `jobId`, theo dõi bằng SSE/WebSocket và lấy kết quả khi hoàn thành.

### 4.5 MCP/WebSocket chưa hỗ trợ multi-user

`client_connection` hiện là biến global. Client mới có thể ghi đè client cũ; danh sách message cũng dùng chung.

Product cần ánh xạ rõ:

```text
tenantId → projectId → sessionId → connectionId
```

Mỗi MCP request phải được xác thực, authorize vào project và có correlation ID. Về dài hạn, MCP nên tạo domain command qua application service, không phụ thuộc browser đang mở.

### 4.6 Persistence chưa đủ cho product

MongoDB hiện chủ yếu phục vụ user. Mô hình kết cấu vẫn phụ thuộc browser và file JSON.

Một product cần tối thiểu:

- Project.
- Model revision.
- Analysis job.
- Analysis result.
- User, organization và membership.
- Audit event.
- File/import asset.
- Subscription/quota nếu là SaaS.

Kiến trúc dữ liệu phù hợp có thể gồm:

- PostgreSQL cho metadata, quyền, revision và job.
- Object storage cho model snapshot lớn, result và file import.
- Redis hoặc queue tương đương cho job/progress.
- Chỉ giữ MongoDB nếu document workflow đem lại lợi ích rõ ràng.

## 5. Khả năng phát triển thành product

### 5.1 Phạm vi phù hợp trong ngắn hạn

Buckle phù hợp phát triển thành:

- Công cụ phân tích sơ bộ cho kỹ sư kết cấu.
- Thiết kế và kiểm tra frame thép đơn giản.
- Công cụ giáo dục/đào tạo FEA.
- Trình dựng mô hình và kiểm tra nhanh trên web.
- AI copilot cho mô hình kết cấu.
- Internal tool cho một công ty tư vấn.

Khoảng cách tới một phần mềm thay thế SAP2000/ETABS/Robot không chỉ nằm ở số loại phần tử, mà còn ở:

- Verification.
- Load combinations.
- Design codes.
- Nonlinear và dynamic analysis.
- BIM interoperability.
- Reporting và auditability.
- Numerical diagnostics.
- Hỗ trợ và trách nhiệm pháp lý.

### 5.2 Product moat khả thi

Moat không nên chỉ là “OpenSees chạy trên web”. Các lợi thế khó sao chép hơn gồm:

1. Trải nghiệm dựng mô hình cực nhanh.
2. AI thao tác mô hình bằng command có thể kiểm tra và hoàn tác.
3. Validation và giải thích lỗi tốt hơn phần mềm truyền thống.
4. Workflow model → analysis → report → share.
5. Template/generator chuyên biệt theo loại kết cấu.
6. Collaboration và review trực tiếp trên web.
7. Traceability: kết quả gắn với revision, solver version và input hash.

## 6. Yêu cầu bắt buộc trước khi thương mại hóa

### 6.1 Độ tin cậy kỹ thuật

Cần xây verification suite gồm:

- Bài toán có nghiệm giải tích.
- Benchmark với OpenSees độc lập.
- So sánh với phần mềm thương mại cho các trường hợp được chọn.
- Kiểm tra dấu nội lực và hệ trục địa phương.
- Kiểm tra unit conversion.
- Kiểm tra release, tải phân bố và tải shell.
- Equilibrium checks.
- Mesh convergence.
- Regression snapshot cho từng solver version.

Mỗi kết quả nên lưu provenance:

- Model revision/hash.
- Schema version.
- Solver và phiên bản.
- Analysis settings.
- Thời gian chạy.
- Warnings.
- Validation status.

### 6.2 Quyền và multi-tenancy

Cần có:

- Organization/workspace.
- Role: owner, engineer, reviewer, viewer.
- Project-level authorization.
- Signed URL cho file/result.
- Quota và giới hạn analysis.
- Audit log.
- Rate limiting.
- CORS allowlist.
- Quản lý secret đúng chuẩn.

### 6.3 Khả năng phục hồi

Kiến trúc phải xử lý được:

- Worker crash.
- Analysis timeout.
- Model quá lớn.
- Solver không hội tụ.
- Browser mất kết nối.
- User chạy lại cùng model.
- Deploy giữa lúc có job.
- Result schema thay đổi.

Job có thể idempotent theo input hash và analysis configuration để tránh chạy lại không cần thiết.

## 7. Kiến trúc đích đề xuất

Không cần chuyển toàn bộ sang microservices. Hướng phù hợp là **modular monolith + analysis workers**:

```text
Frontend SPA
    │
    ▼
Product API
├── Identity & Organizations
├── Projects & Revisions
├── Model Validation
├── Analysis Orchestration
├── Results & Reports
└── MCP/AI Command Gateway
    │
    ├── PostgreSQL
    ├── Object Storage
    ├── Redis/Job Queue
    └── Analysis Workers
          └── OpenSeesPy process
```

Ranh giới module nên được giữ trong code trước khi tách service. Analysis worker là phần cần tách sớm nhất vì có đặc tính CPU-heavy, stateful và có khả năng crash.

Frontend nên tiến về kiến trúc:

```text
Canonical model state
    │
    ├── Command system + history
    ├── Validation
    ├── Persistence/sync
    └── Three.js scene projection
```

Thiết kế này đồng thời hỗ trợ undo/redo, autosave, collaboration và AI actions.

## 8. Lộ trình đề xuất

### Giai đoạn 1 — Làm chắc nền móng

Mục tiêu: private alpha đáng tin cậy.

- Chuẩn hóa `ModelSchema v1`.
- Tách API route khỏi solver implementation.
- Sửa hoặc thay bộ test API cũ.
- Thêm 10–20 benchmark end-to-end.
- Chuẩn hóa đơn vị và hệ tọa độ trong schema.
- Tách frontend domain state khỏi Three.js objects ở các phần mới.
- Lưu project và revision.
- Khóa analysis theo revision/hash.
- Chuẩn hóa error response.

### Giai đoạn 2 — Product beta

Mục tiêu: một nhóm kỹ sư nhỏ sử dụng thật.

- Analysis job queue và worker process.
- Project/workspace/role.
- Autosave và version history.
- Report PDF có provenance.
- Validation trước analysis.
- Dashboard job và usage.
- Monitoring, error tracking và backup.
- MCP session-aware.
- Tối ưu bundle và lazy loading.

### Giai đoạn 3 — Commercial product

Mục tiêu: có thể thu phí và hỗ trợ khách hàng.

- Organization và multi-tenancy đầy đủ.
- Subscription/quota/billing.
- Design combinations và code checks trong phạm vi đã chọn.
- Formal verification matrix.
- Audit log và reviewer workflow.
- Import/export IFC/DXF hoặc integration phù hợp thị trường.
- Collaboration, comment và approval.
- SLA, support tooling và migration policy.

## 9. Ba ưu tiên có đòn bẩy lớn nhất

1. **Chuẩn hóa và version hóa contract mô hình.**
2. **Tách analysis thành job chạy trong worker độc lập.**
3. **Xây verification suite đủ mạnh để người dùng tin kết quả.**

Ba việc này quan trọng hơn việc chuyển sang microservices hoặc đổi framework ở thời điểm hiện tại.

## 10. Tiêu chí đánh giá ở vòng review tiếp theo

| Tiêu chí | Baseline REVIEW1 | Mục tiêu kế tiếp |
|---|---|---|
| Contract model | Nhiều nguồn, chưa version | Một schema versioned và validation tại API |
| Test backend | 21/24 test đạt; test API legacy | Toàn bộ test đạt và có smoke analysis |
| Frontend build | Thành công, bundle ~1.63 MB | Code splitting và không còn asset warning |
| Analysis execution | HTTP đồng bộ, một lock/process | Job API và worker process độc lập |
| Persistence | Chủ yếu file/browser | Project + revision + result persistence |
| MCP sessions | Một connection global | Mapping session/project/user rõ ràng |
| Auth/security | Auth cơ bản, API mở | Authorization, rate limit, CORS allowlist |
| Verification | Unit test tiết diện là chính | Benchmark, equilibrium và regression suite |
| Frontend state | `Model` chịu nhiều trách nhiệm | Tách domain, viewport, UI và analysis state |
| Observability | Log/console cơ bản | Structured logs, metrics, tracing và job history |

## 11. Kết luận

Buckle đã vượt qua giai đoạn demo thuần túy: dự án có domain rõ, UI 3D giàu tính năng và pipeline phân tích thật. Tuy nhiên, kiến trúc hiện tại phù hợp với ứng dụng single-user hoặc private deployment hơn là SaaS production.

Nếu hoàn thành ba trụ cột về contract, analysis worker và verification, codebase hiện tại có thể trở thành nền tảng cho một vertical product tốt, đặc biệt theo hướng phân tích kết cấu nhẹ, cộng tác trên web và AI-assisted modeling.
