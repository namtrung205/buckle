# Hello Buckle — plugin mẫu viết bằng SDK

Mã nguồn TypeScript ở `src/worker.ts` và `src/panel.ts` chỉ import
`@buckle/plugin-sdk`. `npm run build` gộp các import thành `worker.js`, nhúng
script/style của panel và tạo ZIP cài được. Bản build sẵn:
[`../hello-buckle.zip`](../hello-buckle.zip).

## Build lại trong repo

Từ `frontend/examples/hello-plugin`:

```sh
npm install
npm run check
npm run build
```

ZIP mới nằm ở `dist/com.buckle.examples.hello-0.2.0.zip`. Dependency `file:`
trong `package.json` chỉ dùng cho ví dụ nằm cùng repo; dự án bên thứ ba cài
tarball SDK theo [hướng dẫn developer](../../../docs/PLUGIN_DEVELOPER_GUIDE.vi.md).

## Cài và thử

1. Chạy Buckle từ `frontend` bằng `npm run dev`.
2. Mở **File → Manage plugins → Install** và chọn ZIP vừa build hoặc
   `frontend/examples/hello-buckle.zip`. Duyệt ba quyền `model.read`,
   `ui.notify`, `ui.panel`.
3. Sau khi cài, thông báo **Hello Buckle** hiện số node/member của model.
4. Mở tab **Examples** trên ribbon → **Open sample**. Trong panel, nhấn
   **Read model** để đọc số node/member/load qua SDK.
5. Tải lại trang: plugin đã bật được khôi phục. Trong **Manage plugins**, thử
   Disable/Enable hoặc Uninstall; gỡ plugin sẽ xóa tab và panel của nó.

Manifest `buckle.plugin.json` nằm ở gốc ZIP. Nút ribbon gọi handler trong
Worker; handler gọi `api.openPanel`. Panel dùng `PluginPanelClient.forParentWindow()`
để truy vấn model. Không cần viết envelope RPC bằng tay.
