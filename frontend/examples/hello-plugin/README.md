# Hello Buckle — plugin mẫu để cài từ file

Mẫu gồm `buckle.plugin.json`, `worker.js` và `panel.html`. File ZIP đã đóng gói sẵn ở `frontend/examples/hello-buckle.zip`.

## Thử bundle ZIP

1. Chạy ứng dụng: từ thư mục `frontend`, dùng `npm run dev`.
2. Mở tab **File** trên ribbon → **Manage plugins** → **Install**, chọn `frontend/examples/hello-buckle.zip`.
3. Khi cài xong, Worker đọc model và hiện thông báo số node/member.
4. Mở tab **Examples** trên ribbon → **Open sample**. Trong panel bên phải, nhấn **Read model** để đọc lại số node/member/load qua API plugin.
5. Trong **Manage plugins**, nhấn biểu tượng thùng rác ở plugin **Hello Buckle** để gỡ. Tab **Examples** và panel sẽ biến mất.

Bundle xin hai quyền `model.read` và `ui.notify` trong manifest. Panel và Worker chỉ gọi những API được cấp quyền. Plugin chỉ tồn tại trong phiên hiện tại; tải lại trang sẽ gỡ plugin.

## Thử file JS đơn lẻ

Trong **Manage plugins**, chọn hai quyền **model.read** và **ui.notify** ở ô **JS permissions**, rồi nhấn **Install** và chọn `frontend/examples/hello-plugin/worker.js`. File JS đơn lẻ sẽ hiện thông báo khi chạy, nhưng không tạo tab/panel vì không có manifest. Nếu không chọn quyền, lời gọi API sẽ bị từ chối.

## Sửa và đóng gói lại

Từ thư mục `frontend`:

```powershell
node --experimental-strip-types scripts/buckle-plugin.ts validate examples/hello-plugin
Compress-Archive -Path examples/hello-plugin/buckle.plugin.json,examples/hello-plugin/worker.js,examples/hello-plugin/panel.html -DestinationPath examples/hello-buckle.zip -Force
```

Manifest phải nằm ở gốc ZIP. File HTML của panel phải tự chứa script/style; Worker JS phải là một file đã bundle, không import file khác. Loader từ chối đường dẫn không an toàn, loại file lạ và quyền không hợp lệ.
