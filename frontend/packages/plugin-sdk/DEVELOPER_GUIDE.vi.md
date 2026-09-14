# Tạo plugin Buckle bằng SDK

Hướng dẫn này dành cho developer **không có mã nguồn Buckle**. Bạn cần Node.js
22.12 trở lên, npm, file SDK `buckle-plugin-sdk-0.1.0-alpha.1.tgz` và một bản
Buckle có **File → Manage plugins**. SDK alpha hiện được cung cấp bằng tarball,
chưa phát hành trên npm.

## 1. Tạo project từ SDK

Đặt tarball vào một thư mục dễ tìm. Trên PowerShell:

```powershell
$sdkTarball = (Resolve-Path -LiteralPath 'C:\path\to\buckle-plugin-sdk-0.1.0-alpha.1.tgz').Path
npm exec --package "$sdkTarball" -- buckle-plugin init my-plugin
Set-Location my-plugin
npm install "$sdkTarball"
npm run check
npm run build
```

Trên macOS/Linux:

```sh
SDK_TARBALL="$(realpath /path/to/buckle-plugin-sdk-0.1.0-alpha.1.tgz)"
npm exec --package "$SDK_TARBALL" -- buckle-plugin init my-plugin
cd my-plugin
npm install "$SDK_TARBALL"
npm run check
npm run build
```

Lệnh build tạo `dist/com.example.my-plugin-0.1.0.zip`. `npm run check` kiểm tra
TypeScript; `npm run build` gộp các import của Worker và panel thành file có
thể chạy độc lập, rồi đóng gói ZIP. Không cần tự chạy `Compress-Archive` hoặc
chép file JS bằng tay.

Nếu bạn có source Buckle, tạo tarball từ `frontend/packages/plugin-sdk` bằng
`npm pack --pack-destination ../../releases`. Bản tarball đã tạo trong repo ở
`frontend/releases/buckle-plugin-sdk-0.1.0-alpha.1.tgz`.

## 2. Sửa plugin

`buckle.plugin.json` khai báo ID, version, API version, quyền và phần UI đóng
góp. Đổi `com.example.my-plugin` thành ID reverse-domain riêng của bạn, rồi
đổi mọi command/panel/ribbon ID bắt đầu bằng ID cũ. `apiVersion` hiện là `1`.

`src/worker.ts` đăng ký handler cho từng command trong manifest:

```ts
import { createWorkerPlugin } from '@buckle/plugin-sdk'

const plugin = createWorkerPlugin({
  'com.example.my-plugin.open': async api => {
    await api.openPanel('com.example.my-plugin.panel')
  },
})

void plugin.api.notify('Plugin đã sẵn sàng')
```

Nếu gọi `notify`, cần `ui.notify`; nếu gọi `openPanel`, cần `ui.panel`; nếu đọc
model bằng `query`, cần `model.read` trong `permissions`. Mọi command khai báo
phải có handler cùng ID; nếu không, app sẽ từ chối bật plugin.

`src/panel.ts` dùng `PluginPanelClient.forParentWindow()` để gọi API khi người
dùng thao tác trong panel. `panel.html` có thể tham chiếu script/style của
project khi phát triển; CLI sẽ nhúng chúng vào HTML trong ZIP. Worker có thể
import thư viện npm chạy được trong browser; CLI bundle chúng thành một
`worker.js`. Không import mã nội bộ của Buckle.

ZIP cuối cùng chứa manifest ở gốc, `worker.js` và `panel.html`. Kiểm tra trước
khi giao cho người dùng:

```sh
npx buckle-plugin validate dist/com.example.my-plugin-0.1.0.zip
```

## 3. Cài ZIP qua Plugin Manager

1. Mở Buckle → tab **File** trên ribbon → **Manage plugins** → **Install**.
2. Chọn file `.zip` trong `dist`; kiểm tra tên, ID, version và quyền → **Install plugin**.
3. Mở tab ribbon do plugin đóng góp và nhấn nút command. Starter mở panel;
   nút **Read model** trong panel đọc số node/member của model.
4. Tải lại app để kiểm tra plugin đã bật được khôi phục. **Manage plugins** cho
   phép Disable, Enable, cài ZIP phiên bản mới để cập nhật, hoặc Uninstall.

Plugin mẫu có sẵn để thử ngay:
`frontend/examples/hello-buckle.zip`. Source dùng SDK ở
`frontend/examples/hello-plugin`; xem README của mẫu để build lại.

## Khi có lỗi

| Triệu chứng | Kiểm tra |
| --- | --- |
| `npm install` tìm SDK trên npm | Cài tarball bằng đường dẫn như bước 1 trước khi chạy các npm script. |
| Không có ZIP trong `dist` | Chạy `npm run build` và kiểm tra dòng `Built ...zip`; không coi exit code đơn lẻ là đủ. |
| `COMMAND_MISMATCH` hoặc Worker không ready | Command ID trong manifest phải khớp chính xác với key trong `createWorkerPlugin`. |
| Lời gọi API bị `PERMISSION_DENIED` | Thêm đúng quyền vào `permissions`, build ZIP mới và cài lại để duyệt quyền. |
| `PANEL_NOT_SELF_CONTAINED` | Build bằng CLI SDK để nhúng script/style; không tự zip các file source. |
| Không thấy ribbon của plugin | Xem trạng thái plugin và log trong Manage plugins; bật lại nếu đang disabled. |

Tham khảo [README SDK](README.md) và
[API v1](API_V1.md) để xem phương thức và giới
hạn payload. Ký ZIP là tùy chọn của alpha; quy trình ZIP không ký ở trên vẫn
cài và chạy được sau khi người dùng duyệt quyền.
