# Setup Guide - Cài đặt môi trường trên máy mới

Script này tự động cài đặt tất cả các công cụ cần thiết và dependencies cho project **Buckle** trên máy mới.

## Công cụ sẽ được cài đặt

| Công cụ | Phiên bản | Mục đích |
|---------|-----------|----------|
| **Git** | Latest | Clone repository, quản lý version |
| **Node.js** | v18+ (LTS) | Chạy frontend React |
| **npm** | Latest | Quản lý dependencies frontend |
| **Python** | v3.12+ | Chạy backend FastAPI |
| **MongoDB** | Latest (Optional) | Database cho user authentication |
| **Docker** | Latest (Optional) | Chạy full stack bằng docker-compose |

## Yêu cầu trước khi chạy

- **Windows 10/11**: Có [winget](https://learn.microsoft.com/en-us/windows/package-manager/) (cài sẵn trên Windows 10 1809+)
- **macOS**: Có [Homebrew](https://brew.sh/) (nếu chưa có, script sẽ hướng dẫn)
- **Linux (Ubuntu/Debian/Fedora/Arch)**: Có quyền `sudo`

## Cách sử dụng

### Windows

```bat
:: Chạy với quyền Administrator (khuyến nghị)
setup.bat
```

### macOS / Linux

```bash
# Cấp quyền thực thi
chmod +x setup.sh

# Chạy
./setup.sh
```

## Script sẽ làm gì

1. **Kiểm tra & cài đặt Git** - Nếu chưa có, tự động cài qua winget/brew/apt
2. **Kiểm tra & cài đặt Node.js + npm** - Nếu chưa có, tự động cài Node.js LTS
3. **Kiểm tra & cài đặt Python** - Nếu chưa có, tự động cài Python 3.12
4. **Kiểm tra MongoDB** (Optional) - Chỉ kiểm tra, không tự cài
5. **Kiểm tra Docker** (Optional) - Chỉ kiểm tra, không tự cài
6. **Clone project & cài dependencies**:
   - Clone repository `https://github.com/namtrung205/buckle.git`
   - Tạo file `.env` từ `.env.example`
   - Cài frontend dependencies: `npm install`
   - Tạo Python virtual environment: `python -m venv env`
   - Cài backend dependencies: `pip install -r requirements.txt`

## Sau khi setup hoàn tất

### Chạy Frontend

```bash
cd frontend
npm run dev
```

Mở trình duyệt tại: **http://localhost:5173**

### Chạy Backend

```bash
# Windows
cd backend
env\Scripts\activate
python main.py

# macOS/Linux
cd backend
source env/bin/activate
python main.py
```

API docs tại: **http://localhost:8000/docs**

### Chạy Full Stack bằng Docker (Optional)

```bash
docker-compose up --build
```

- Frontend: **http://localhost:8080**
- Backend: **http://localhost:8001/docs**

## Cấu hình `.env`

Sau khi script tạo file `.env`, bạn cần chỉnh sửa:

```env
# Cloudflare Tunnel (nếu dùng)
CLOUDFLARE_TUNNEL_TOKEN=your_tunnel_token_here

# Backend URL cho frontend
VITE_BACKEND_SERVER=http://localhost:8000

# MongoDB
MONGODB_URL=mongodb://localhost:27017
MONGODB_DB_NAME=buckle_db

# Port mapping
FRONTEND_PORT=8180
BACKEND_PORT=8101
```

## Troubleshooting

### Lỗi: "Not running as Administrator" (Windows)

Một số tool cần quyền admin để cài đặt. Chạy lại script với quyền Administrator:
- Click chuột phải vào `setup.bat` → **Run as administrator**

### Lỗi: "The system cannot find the path specified" / npm error ENOENT (system32\package.json)

Nguyên nhân: khi chạy `setup.bat` bằng **Run as administrator**, thư mục làm việc mặc định của cmd là `C:\WINDOWS\system32`, khiến các lệnh `cd frontend` / `npm install` chạy sai chỗ.

Script đã được fix tự động bằng lệnh `cd /d "%~dp0"` ngay đầu file — luôn chuyển về đúng thư mục chứa `setup.bat` trước khi làm bất cứ việc gì. Nếu bạn dùng bản script cũ, hãy tải lại bản mới.

### Lỗi: npm error ERESOLVE (vite 8 vs @vitejs/plugin-react 4)

`@vitejs/plugin-react@4` chỉ hỗ trợ tới Vite 7, trong khi project dùng `vite@^8.0.3`, gây xung đột peer dependency khi `npm install`.

Script đã fix bằng cách nâng `@vitejs/plugin-react` lên `^5.0.0` (hỗ trợ Vite 8) trong `frontend/package.json`. Nếu gặp lỗi này trên bản cũ, chạy:

```bash
cd frontend
npm install @vitejs/plugin-react@^5.0.0 --save-dev
```

### Lỗi: Node.js/Python vừa cài nhưng không nhận

Sau khi cài Node.js hoặc Python, cần **đóng và mở lại terminal** để PATH được cập nhật, sau đó chạy lại script. (Script tự động dừng và nhắc bạn làm việc này.)

### Lỗi: `pip install` thất bại với OpenSeesPy

OpenSeesPy yêu cầu Python 3.12+. Kiểm tra phiên bản:

```bash
python --version
```

Nếu không đúng, cài Python 3.12 và tạo lại virtual environment:

```bash
# Windows
rmdir /s /q backend\env

# macOS/Linux
rm -rf backend/env
```

Sau đó chạy lại `setup.bat` hoặc `setup.sh`.

### MongoDB không chạy

Nếu không cài MongoDB, các tính năng user authentication sẽ không hoạt động. Có thể dùng Docker:

```bash
docker run -d -p 27017:27017 --name buckle-mongo mongo:latest
```

## Cài đặt thủ công (nếu script không hoạt động)

### Windows (winget)

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Python.Python.3.12 -e
winget install --id MongoDB.Server -e
winget install --id Docker.DockerDesktop -e
```

### macOS (Homebrew)

```bash
brew install git
brew install node@18
brew install python@3.12
brew tap mongodb/brew && brew install mongodb-community
brew install --cask docker
```

### Ubuntu/Debian

```bash
sudo apt update
sudo apt install -y git
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
sudo apt install -y python3 python3-venv python3-pip
```

## Cấu trúc project sau khi setup

```
buckle/
├── .env                    # Cấu hình (tự tạo từ .env.example)
├── frontend/
│   ├── node_modules/       # Frontend dependencies
│   └── package.json
├── backend/
│   ├── env/                # Python virtual environment
│   └── requirements.txt
└── setup.bat / setup.sh    # Setup scripts