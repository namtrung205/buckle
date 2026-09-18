# Tower Lab — plugin thử nghiệm cho Buckle

Plugin bên thứ 3 **port toàn bộ generator tháp lưới 500 kV** của Buckle sang nền tảng plugin SDK (worker + panel sandbox).
Mục đích: **chạy song song với generator built-in** để so sánh — không thay thế, không đụng dữ liệu của built-in.

## Cách hoạt động

- **Ribbon “Tower Lab”** → mở panel (plain DOM + canvas, chạy trong iframe sandbox).
- Panel đọc model qua `model.query`, tính **graph ngữ nghĩa** thuần (`tpl:` roles) và **tự diff** với snapshot:
  chỉ tạo/sửa/xóa phần chênh lệch, gói trong **1 Transaction = 1 bước Undo**.
- Dữ liệu parametric dùng kind riêng **`TowerPlugin`** → object của built-in (`Tower`) và AI copilot hoàn toàn không bị ảnh hưởng.
- Khi có entity cũ bị loại (ví dụ giảm số tầng), plugin gửi kèm `approval: true` — bạn phải nhấn **Tạo trụ 2 lần** để xác nhận destructive.
- Tham số lần tạo cuối được lưu vào project storage và khôi phục khi mở lại panel.

## Build & cài đặt

Cài SDK tarball đi kèm Buckle trước (SDK alpha chưa publish lên npm), hoặc dùng trực tiếp qua `file:` dependency như repo này:

```sh
# trong frontend/packages/plugin-sdk (nếu chưa build)
npm install && npm run build

# trong thư mục plugin này
npm install
npm run check   # tsc --noEmit
npm test        # unit test planner (node --test)
npm run build   # buckle-plugin build .  →  dist/com.buckle.examples.tower-0.1.0.zip
```

Cài file ZIP qua **File → Manage plugins → Install**, duyệt quyền rồi Enable.

## Giới hạn đã biết

- Regenerate chỉ áp dụng cho object `TowerPlugin`; nếu plugin bị uninstall, object vẫn hiển thị như dữ liệu tĩnh.
- Envelope RPC 256 KiB: với tham số cực lớn (nhiều chục tầng) transaction có thể vượt giới hạn — giảm `panelCount` nếu gặp lỗi payload.
- Bước Undo: 1 lần tạo = 1 transaction = 1 undo step (ngang built-in).