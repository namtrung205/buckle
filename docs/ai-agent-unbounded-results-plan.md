# Phương án Agent không giới hạn nội bộ và AI đánh giá kết quả analysis

Ngày: 2026-09-17. Trạng thái: thiết kế triển khai, chưa thay đổi runtime.

## 1. Mục tiêu

- Agent thực hiện một yêu cầu đến khi đạt mục tiêu, người dùng dừng hoặc có vấn đề thực sự cần người dùng xử lý; không kết thúc vì số bước, số vòng hay tuổi của cuộc hội thoại.
- Delete/edit/create và workflow nhiều bước tiếp tục được trong cùng tác vụ.
- AI đọc kết quả solver, truy vấn chi tiết, kiểm tra bằng phép tính xác định và viết báo cáo Markdown/HTML có nguồn số liệu.
- Tăng số vòng không tự bảo đảm chất lượng. Chất lượng đến từ công cụ đầy đủ, kết quả có nguồn, kiểm chứng số liệu và tiêu chí hoàn thành rõ ràng.

## 2. Những giới hạn cần bỏ hoặc thay thế

| Hiện tại | Thiết kế mới |
| --- | --- |
| 20 bước, 10 mutation, 60 giây theo executor | Không có budget mặc định hay budget cứng cho Agent; ghi thống kê để quan sát |
| 6 vòng gọi model | Vòng chạy bất đồng bộ đến khi hoàn thành hoặc Stop |
| Phát hiện query lặp rồi tắt tools | Ghi cảnh báo không tiến triển, đưa kết quả so sánh cho model đổi hướng; không tự cắt tools hoặc kết thúc |
| 25 tool calls mỗi phản hồi | Thực thi toàn bộ danh sách hợp lệ; thao tác phụ thuộc chạy tuần tự |
| 40 definitions / 40 results | Registry không có trần này; full transcript và tool results lưu riêng, chọn nội dung cần thiết vào context |
| Prompt/history 4.000 ký tự, history 12 tin, context 250 KB | Bỏ trần ứng dụng cố định; context assembler phù hợp cửa sổ thực của model, giữ bản gốc đầy đủ ngoài prompt |
| Mất tool results khi hết lượt | Lưu theo runId/turnId/callId, cho truy vấn lại và tiếp tục sau Apply/reload |
| Query tối đa 10.000, mặc định lấy 1.000 | Cursor, count, aggregate, result-set handle; đọc toàn bộ được qua nhiều trang, không hiểu một trang là toàn bộ dữ liệu |
| Batch/schema/transaction chặn tác vụ lớn | Planner tạo batch từ tập đích đầy đủ. Nếu chia nhỏ mất tính atomic phải công bố và dùng checkpoint/undo; với thao tác cần atomic dùng transaction staging trước khi commit |
| Preview đầu tiên kết thúc lượt | Trạng thái awaiting_approval; Apply/Reject trở thành tool result rồi Agent tiếp tục |
| Mọi edit provider đều bị ép preview | Agent dùng quyền của yêu cầu hiện tại cho các thay đổi đã được giao rõ; preview là khả năng xem trước, không phải điểm dừng bắt buộc cho mọi bước. Mục tiêu/đối tượng mơ hồ cần làm rõ |
| Local RPM/TPM/concurrency và thời gian chờ/retry cố định | Agent không dùng quota do Buckle tự áp đặt; xử lý quota thực từ provider, chờ có thể hủy và hiển thị thời điểm thử lại |
| HTTP timeout 60 giây cắt suy luận dài | Request/job có heartbeat và cancellation; phân biệt transport mất kết nối với tác vụ còn chạy, tiếp tục qua checkpoint |
| Anthropic output 2.200 tokens | Tham số phù hợp model/provider; phát hiện output bị cắt và tiếp tục, không biến thành báo cáo hoàn chỉnh hoặc tool arguments hợp lệ |

Giới hạn context/output/quota của provider và tài nguyên máy không thể bị xóa bằng code Buckle. UI phải phân biệt rõ những giới hạn này với lỗi nội bộ. Không giữ toàn bộ dữ liệu vô hạn trong RAM hay nhét lại toàn bộ kết quả vào mỗi request.

Schema hợp lệ, tham chiếu entity, revision/hash, tính đúng topology, quyền truy cập và tính atomic là điều kiện đúng đắn của thao tác. Bỏ các điều kiện này có thể tạo mô hình sai, nên không coi chúng là budget cần xóa. Các miền giá trị toán học như kích thước dương hoặc vector 3 thành phần cũng giữ nguyên.

## 3. Agent runtime

Tách orchestration khỏi component React thành AgentRunner và RunStore. UI chỉ gửi yêu cầu, hiển thị trạng thái, Stop/Resume và phê duyệt khi cần.

State machine:

`queued → running ↔ waiting_provider / awaiting_approval → completed / stopped / failed`

- Checkpoint sau mỗi kết quả tool; lưu prompt gốc, phần việc còn lại, evidence, mutation ledger và context summary.
- Call ID thuộc tool call đã được lên kế hoạch và lưu lại. Retry transport/Resume dùng lại call đó; không lấy vị trí round/index làm định danh cho một kế hoạch được model tạo lại.
- Await từng tool bất đồng bộ; không chạy song song mutations có phụ thuộc revision.
- Stop hủy chờ provider và tác vụ đang chạy có hỗ trợ hủy; kiểm tra cancellation trước mỗi tool/commit. Thao tác đã commit được báo rõ và có Undo.
- Provider streaming thực, trạng thái tool và usage cập nhật trong lúc chạy.
- Lặp công cụ không tự kết thúc run. Theo dõi input, output, revision và tiến triển để yêu cầu model thay chiến lược; người dùng luôn có Stop.
- Tool lỗi trả mã riêng: MODE_DENIED, INVALID_ARGUMENTS, STALE_REVISION, PROVIDER_QUOTA, AUTH_REQUIRED, ANALYSIS_FAILED… thay vì gom vào VALIDATION_ERROR.
- Hoàn thành dựa vào checklist mục tiêu và kết quả kiểm chứng; câu trả lời cuối ghi cả phần chưa thực hiện nếu có.
- Sửa payload Apply: chỉ dùng preview khi schema nhận trường này; delete_entities và execute_transaction hiện không nhận preview.

## 4. Nền tảng analysis hiện có

- TopBar tạo analysis snapshot, POST /analysis, kiểm tra revision, ghi model.output cùng analysisRevision/analysisSnapshotHash rồi lockResults.
- Output TypeScript hiện có nodes/displacements, members/stations/node_efforts/displacement_stations và reactions.
- ResultStore chuyển dữ liệu sang Float32Array và lấy mẫu mặc định 20 điểm/member phục vụ render. Không dùng cache này làm nguồn số liệu cực trị chính xác cho báo cáo.
- /llm-analysis hiện chạy lại solver và trả các bảng; không gọi LLM. Bảng nội lực hiện không có đủ mọi thành phần, không thay thế được result query service.
- unlockResults xóa kết quả hiện tại. Cần lưu snapshot kết quả độc lập trước khi hỗ trợ vòng sửa → chạy lại → so sánh.
- OpenSees dùng singleton/global state cùng analysis_lock. Không gỡ lock rồi chạy nhiều analysis chung tiến trình; dùng job queue hoặc worker process riêng cho từng job nếu cần chạy song song.

## 5. AnalysisRunStore và AnalysisService

Trích workflow từ TopBar sang AnalysisService để UI và Agent dùng cùng đường chạy.

Một AnalysisRun chứa:

- runId, modelRevision, snapshotHash, input snapshot và mapping entity/mesh;
- startedAt/completedAt, trạng thái solver, diagnostics và phiên bản solver;
- units, hệ trục toàn cục, hệ trục local member, quy ước dấu, thông tin sampling;
- case/combination nếu solver thực sự có, không dựng trường hợp tải không tồn tại;
- raw output bất biến và index truy vấn;
- summary/metrics được tính bằng code, findings và report artifacts;
- provenance cho mỗi finding: runId, entityId, component, station, value, unit, method và case khi có.

Đối với kết quả hiện tại chỉ có một lần phân tích, trả một case thực; không giả định ứng dụng đã có multi-case/envelope.

Mọi kết quả gắn với snapshot cụ thể. Khi mô hình đổi, bản cũ vẫn đọc và so sánh được nhưng phải ghi là kết quả của revision cũ. Lấy mẫu rời rạc phải được ghi rõ; cực trị trên các station solver không đồng nghĩa cực trị liên tục chính xác giữa các station.

## 6. Tool cho AI phân tích kết quả

| Tool đề xuất | Nội dung |
| --- | --- |
| run_analysis | Chạy snapshot, trả analysisRunId/jobId, trạng thái và lỗi xác định |
| get_analysis_status | Trạng thái và diagnostics theo jobId; hoàn thành thì có result reference |
| list_analysis_runs | Các lần chạy, revision, hash và trạng thái |
| get_analysis_summary | Độ đầy đủ dữ liệu, cực trị, số entity, cảnh báo, units và trục |
| query_node_results | Displacements/rotations theo IDs, vùng, component, điều kiện và cursor |
| query_member_results | N, lực cắt, xoắn, moment và displacement stations; giữ local axis/station |
| query_support_reactions | Lực và moment gối, tọa độ và kiểu restraint |
| get_result_extrema | Min/max/absolute-max có ID, station và phương pháp tính; top-K là cách trình bày, có thể lấy tiếp toàn bộ |
| check_result_equilibrium | Tổng tải/phản lực và moment cùng hệ trục, gốc tính và tolerance |
| check_serviceability | Kiểm tra theo ngưỡng/công thức và đối tượng được khai báo; trả cả assumptions |
| compare_analysis_runs | Đối chiếu input thay đổi, displacement/nội lực/phản lực; xử lý mapping khi entity tạo/xóa |
| show_result_view | Chọn component, diagram/deformed shape và highlight đối tượng có finding |
| create_analysis_report | Tạo Markdown/HTML từ findings có provenance, bảng và biểu đồ |

Thiết kế registry chung cho Copilot/backend/MCP; thêm tests xác nhận parity. Tool analysis là async nên AiToolExecutor hiện đồng bộ cần async adapter hoặc được tách khỏi structural executor.

## 7. Quy trình AI sau khi solver chạy xong

1. Nhận analysisRunId qua event hoàn thành hoặc nút Đánh giá bằng AI; có lựa chọn tự đánh giá sau mỗi lần chạy thành công.
2. Kiểm tra snapshot, convergence/diagnostics, dữ liệu thiếu và khả năng truy vấn trước khi kết luận.
3. Lấy summary bằng code, tìm các vị trí đáng chú ý bằng cực trị trên dữ liệu gốc.
4. Kiểm tra cân bằng lực/moment bằng applied loads thực tế của solver và phản lực, cùng hệ trục và units. Chưa đủ moment tải/nodal loads phải trả unsupported/incomplete, không báo pass.
5. Truy vấn sâu các member/node/gối liên quan; đối chiếu hình học, section, vật liệu, liên kết, release và tải.
6. Kiểm tra chuyển vị/độ võng/drift khi có định nghĩa span/tầng, ngưỡng và case thích hợp. Độ võng tương đối với dây cung khác chuyển vị tuyệt đối; code phải tính đúng đại lượng.
7. Viết findings với evidence; tách quan sát số liệu, giả thuyết nguyên nhân, điều kiện kiểm tra và đề xuất sửa.
8. Hiển thị báo cáo cùng hành động xem vị trí, biểu đồ, truy vấn sâu và tạo phương án sửa.
9. Khi được giao cải tiến mô hình: lưu baseline → sửa trong phạm vi yêu cầu → chạy lại → so sánh cùng điều kiện tải → kiểm chứng mục tiêu. Không có trần số vòng; dừng khi mục tiêu đạt, người dùng Stop hoặc có vấn đề cần giải quyết.

AI không tự gán nhãn đạt tiêu chuẩn/chịu lực an toàn từ việc solver hội tụ. Kiểm tra sức chịu tải/buckling/utilization cần module tính theo tiêu chuẩn, tham số và tổ hợp tương ứng; giai đoạn đầu đánh giá kết quả và serviceability có điều kiện. Shell stress/design cần bổ sung output solver trước khi expose tool có nội dung đó.

## 8. Giao diện báo cáo

- Chat render Markdown: headings, bảng, công thức, danh sách, code và liên kết entity.
- Report panel rộng/resizable; log tool thu gọn, kết quả có trạng thái và evidence mở được.
- Summary cards: run/revision, solver status, chuyển vị đáng chú ý, nội lực đáng chú ý, phản lực và kiểm tra đã thực hiện.
- Bảng finding: mức độ, quan sát, giá trị/đơn vị, vị trí, case, cơ sở kiểm tra, hành động.
- Biểu đồ lấy dữ liệu trực tiếp từ result query service, không lấy các con số do LLM viết lại.
- Export Markdown/HTML. HTML sanitize hoặc sandbox; báo cáo không tự chạy script do model sinh ra.
- Phân biệt chưa kiểm tra, thiếu dữ liệu, không áp dụng, đạt/không đạt tiêu chí đã khai báo.

## 9. Thứ tự triển khai và nghiệm thu

### Đợt 1 — Unbounded Agent và sửa lỗi luồng thao tác

AgentRunner/RunStore, gỡ hard budget/loop-stop, sửa Apply, tiếp tục sau preview, cancellation, typed errors, parity registry. Tác vụ vượt 6 vòng/20 calls/10 mutations và hoạt động sau hơn 60 giây vẫn chạy; query lặp không bị ép kết thúc; Apply delete không lỗi schema; Stop không phát sinh commit mới sau khi xác nhận dừng.

### Đợt 2 — Context, khả năng phục hồi và tool coverage

Persist full transcript/results, context compaction theo provider, cursor/aggregate/result-set handles, batch staging, schema edit/transaction rõ ràng, hỗ trợ request dài và output continuation. Bổ sung tool tạo loads/supports/shells và selection sets theo canonical contract. Kiểm chứng resume không lặp commit, entity selection không bị cắt âm thầm, quota provider được báo đúng nguồn.

### Đợt 3 — Result snapshot và truy vấn

AnalysisService, immutable AnalysisRunStore, async analysis tools, unit/axis adapter, summary/extrema/node/member/reaction queries và viewport links. Dùng fixtures có nghiệm biết trước, trường hợp đổi trục/dấu, model revision thay đổi, thiếu dữ liệu, nhiều station và cực trị có thể bị mất khi resample.

### Đợt 4 — AI review và báo cáo

Kiểm tra cân bằng và serviceability có điều kiện, findings có provenance, Markdown/HTML, so sánh baseline/candidate. Test tái tính được mọi con số trong báo cáo, không suy diễn multi-case/shell/design khi output chưa có; model unlock/edit không làm mất baseline đã lưu.

Hoàn thành đợt 1 giải quyết lỗi limit hiện tại. Đợt 3–4 mới cung cấp khả năng AI đánh giá result sau analysis.
