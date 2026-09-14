# Bulk Rename — plugin mẫu dùng Buckle SDK

Plugin này đóng góp tab **Plugins** và nút **Bulk Rename** trên ribbon. Nhấn nút
để mở panel bên phải. Panel đổi tên hàng loạt **Nodes** hoặc **Elements**
(members và shells), với phạm vi **Đang chọn** hoặc **Toàn bộ model**. Nhập
**Prefix**, **Suffix** hoặc cả hai, nhấn **Xem trước** rồi **Đổi tên**.

Nếu entity chưa có tên, plugin dùng `Node <id>`, `Member <id>` hoặc `Shell <id>`
làm tên gốc. Ví dụ prefix `T1-` và suffix `-REV` đổi `Beam 12` thành
`T1-Beam 12-REV`. Một lần nhấn Đổi tên gửi một transaction, nên có thể Undo
trong Buckle. Nếu model thay đổi sau lúc xem trước, app từ chối commit theo
revision và bạn chỉ cần xem trước lại.

## Cài bản build sẵn

1. Mở Buckle → **File → Manage plugins → Install**.
2. Chọn [`../bulk-rename.zip`](../bulk-rename.zip) và duyệt các quyền hiển thị.
3. Mở tab **Plugins** → **Bulk Rename**. Nếu thử phạm vi **Đang chọn**, hãy chọn
   node/member/shell trong app trước khi nhấn **Xem trước**.
4. Nhập prefix hoặc suffix, xem danh sách tên cũ → mới, rồi nhấn **Đổi tên**.

## Build lại từ source

Yêu cầu Node.js 22.12+ và npm. Trong thư mục này:

```sh
npm install
npm run check
npm test
npm run build
npx buckle-plugin validate dist/com.buckle.examples.bulk-rename-0.1.0.zip
```

ZIP nằm ở `dist/com.buckle.examples.bulk-rename-0.1.0.zip`. Đây là một project
SDK độc lập: mã chạy plugin chỉ import `@buckle/plugin-sdk`. Trong repo, dependency
`file:../../packages/plugin-sdk` trỏ tới SDK local; khi phát triển bên ngoài,
thay bằng đường dẫn tới tarball `buckle-plugin-sdk-0.1.0-alpha.1.tgz` được cung
cấp theo [hướng dẫn developer](../../packages/plugin-sdk/DEVELOPER_GUIDE.vi.md).

`buckle.plugin.json` khai báo các quyền `model.read`,
`workspace.readSelection`, `model.write.nodes`, `model.write.members`,
`model.write.shells`, `ui.panel`, `ui.notify`. Worker đăng ký command cho nút
ribbon và mở panel bằng `api.openPanel`. Panel dùng `api.query()` và
`api.getSelection()` để lập preview, rồi `api.execute()` với một transaction
gồm `MoveNodes`, `UpdateMembers`, `CreateOrUpdateShells`.
