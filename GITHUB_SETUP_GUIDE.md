# Hướng dẫn đẩy MediDB lên GitHub

---

## Mục lục

1. [Cài đặt & cấu hình Git](#1-cài-đặt--cấu-hình-git)
2. [Tạo repository trên GitHub](#2-tạo-repository-trên-github)
3. [Khởi tạo Git & đẩy code lần đầu (Terminal)](#3-khởi-tạo-git--đẩy-code-lần-đầu-terminal)
4. [Làm việc với Git trong VS Code](#4-làm-việc-với-git-trong-vs-code)
5. [Quy trình làm việc hàng ngày](#5-quy-trình-làm-việc-hàng-ngày)
6. [Xử lý lỗi thường gặp](#6-xử-lý-lỗi-thường-gặp)

---

## 1. Cài đặt & cấu hình Git

### 1.1 Kiểm tra Git đã cài chưa

Mở PowerShell và chạy:

```powershell
git --version
```

Nếu trả về `git version 2.x.x` → đã có Git, bỏ qua bước 1.2.

### 1.2 Cài Git (nếu chưa có)

Tải tại: **https://git-scm.com/download/win**

Cài với tùy chọn mặc định. Sau khi cài xong, khởi động lại PowerShell.

### 1.3 Cấu hình Git (chạy 1 lần duy nhất)

```powershell
git config --global user.name  "Tên của bạn"
git config --global user.email "email@cua.ban@example.com"
git config --global core.autocrlf true
git config --global init.defaultBranch main
```

> **Lưu ý:** Dùng đúng email GitHub để commit được gắn với tài khoản.

### 1.4 Xác thực với GitHub (Personal Access Token)

GitHub không còn hỗ trợ mật khẩu thường khi push. Cần tạo **Personal Access Token (PAT)**:

1. Đăng nhập GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**
2. Nhấn **Generate new token (classic)**
3. Đặt tên: `MediDB-push`, Expiration: `90 days`
4. Tích vào **`repo`** (toàn bộ quyền repository)
5. Nhấn **Generate token** → **Copy token ngay** (chỉ hiện 1 lần!)

> Giữ token này an toàn. Dùng thay mật khẩu khi Git hỏi password.

---

## 2. Tạo repository trên GitHub

1. Đăng nhập **https://github.com**
2. Nhấn **New repository** (nút `+` góc trên phải → **New repository**)
3. Điền thông tin:
   - **Repository name:** `medidb-cdss` (hoặc tên bạn muốn)
   - **Description:** `Clinical Decision Support System — DrugBank v5 · FastAPI · React`
   - **Visibility:** `Public` hoặc `Private` tuỳ ý
   - ❌ **KHÔNG tích** `Add a README file`, `Add .gitignore`, `Choose a license`  
     (vì dự án đã có sẵn, nếu tích sẽ gây xung đột)
4. Nhấn **Create repository**
5. GitHub hiển thị trang với URL dạng:  
   `https://github.com/username/medidb-cdss.git`  
   → **Copy URL này**

---

## 3. Khởi tạo Git & đẩy code lần đầu (Terminal)

Mở PowerShell, chạy từng lệnh theo thứ tự:

### Bước 1 — Di chuyển vào thư mục gốc dự án

```powershell
cd D:\Du_an
```

### Bước 2 — Khởi tạo Git repository

```powershell
git init
```

### Bước 3 — Kiểm tra file nào sẽ được track

```powershell
git status
```

> Các file trong `.gitignore` (như `.venv/`, `node_modules/`, `drugbank_full.xml`) sẽ không hiện ở đây — bình thường.

### Bước 4 — Thêm tất cả file vào staging

```powershell
git add .
```

### Bước 5 — Tạo commit đầu tiên

```powershell
git commit -m "feat: initial commit — MediDB CDSS v1.0

- FastAPI backend with DrugBank interaction engine
- React + Vite + TypeScript frontend
- MySQL schema with 17,430 drugs & 24,386 interactions"
```

### Bước 6 — Kết nối với GitHub repository

```powershell
# Thay URL bằng URL repo bạn vừa copy ở bước 2
git remote add origin https://github.com/YOUR_USERNAME/medidb-cdss.git
```

### Bước 7 — Đẩy code lên GitHub

```powershell
git push -u origin main
```

Git sẽ hỏi:
- **Username:** tên đăng nhập GitHub
- **Password:** dán **Personal Access Token** (không phải mật khẩu GitHub)

> Sau lần đầu, Windows Credential Manager sẽ lưu thông tin, các lần sau không cần nhập lại.

### Kết quả

Truy cập `https://github.com/YOUR_USERNAME/medidb-cdss` để xem code đã lên.

---

## 4. Làm việc với Git trong VS Code

VS Code có tích hợp Git visualization hoàn chỉnh, không cần extension thêm.

### 4.1 Mở Source Control Panel

| Cách | Hành động |
|---|---|
| Phím tắt | `Ctrl + Shift + G` |
| Sidebar | Nhấn icon **Source Control** (icon nhánh cây) |
| Menu | **View → Source Control** |

### 4.2 Giao diện Source Control

```
SOURCE CONTROL
├── Changes            ← File đã sửa (chưa stage)
├── Staged Changes     ← File đã add (sẵn sàng commit)
└── Merge Changes      ← Khi có conflict
```

**Các hành động:**

| Icon | Hành động |
|---|---|
| `+` bên cạnh file | Stage file đó (`git add <file>`) |
| `+` bên cạnh "Changes" | Stage tất cả (`git add .`) |
| `-` bên cạnh Staged file | Unstage (`git restore --staged`) |
| `↩` bên cạnh file | Discard changes (cẩn thận — không hoàn tác được) |

### 4.3 Tạo commit trong VS Code

1. Stage các file muốn commit (nhấn `+`)
2. Nhập message vào ô **"Message"** (góc trên Source Control panel)
3. Nhấn `Ctrl + Enter` hoặc nhấn nút **✓ Commit**

### 4.4 Push / Pull trong VS Code

| Hành động | Cách thực hiện |
|---|---|
| **Push** (đẩy lên) | Nhấn `...` menu → **Push** hoặc nhấn icon **↑** trên Status Bar |
| **Pull** (kéo về) | Nhấn `...` menu → **Pull** hoặc nhấn icon **↓** trên Status Bar |
| **Sync** (pull rồi push) | Nhấn icon **↑↓** ngoài Status Bar (góc dưới trái) |

> **Status Bar** (thanh dưới cùng VS Code) hiển thị:  
> `↑1 ↓0` — nghĩa là có 1 commit chưa push, 0 commit chưa pull.

### 4.5 Xem lịch sử commit — Cài GitLens (khuyến nghị)

1. Mở Extensions: `Ctrl + Shift + X`
2. Tìm **GitLens — Git supercharged** (tác giả: GitKraken)
3. Nhấn **Install**

Sau khi cài, GitLens thêm:
- **Inline blame** — ai commit dòng này, khi nào
- **File History** — lịch sử thay đổi file
- **Graph** — đồ thị nhánh commit trực quan

### 4.6 Xem diff file trong VS Code

- Click vào file trong **Changes** → VS Code mở cửa sổ diff (trái: cũ, phải: mới)
- Màu **xanh lá** = dòng thêm, màu **đỏ** = dòng xóa

---

## 5. Quy trình làm việc hàng ngày

### Khi bắt đầu làm việc

```powershell
cd D:\Du_an
git pull origin main    # kéo thay đổi mới nhất từ GitHub
```

### Sau khi sửa code

```powershell
git status              # xem file nào thay đổi
git add .               # hoặc add từng file: git add app/main.py
git commit -m "fix: mô tả ngắn thay đổi"
git push origin main    # đẩy lên GitHub
```

### Chuẩn message commit (khuyến nghị)

| Prefix | Ý nghĩa |
|---|---|
| `feat:` | Thêm tính năng mới |
| `fix:` | Sửa bug |
| `docs:` | Cập nhật tài liệu |
| `refactor:` | Refactor code |
| `style:` | Thay đổi giao diện, CSS |
| `chore:` | Cấu hình, dependencies |

Ví dụ:
```
feat: add risk score visualization to AnalysisPage
fix: resolve bidirectional interaction lookup bug
docs: update API endpoints in PROJECT_GUIDE.md
```

---

## 6. Xử lý lỗi thường gặp

### ❌ Lỗi: `remote: Support for password authentication was removed`

**Nguyên nhân:** Dùng mật khẩu GitHub thay vì Personal Access Token.

**Giải quyết:** Mở Windows Credential Manager:
1. Tìm kiếm **Credential Manager** trong Start Menu
2. Chọn **Windows Credentials**
3. Tìm entry `git:https://github.com` → **Edit** hoặc **Remove**
4. Push lại, nhập PAT vào ô **Password**

---

### ❌ Lỗi: `error: failed to push some refs` / `rejected`

**Nguyên nhân:** Remote có commit mà local chưa có.

**Giải quyết:**
```powershell
git pull origin main --rebase
git push origin main
```

---

### ❌ Lỗi: `The file exceeds GitHub's file size limit of 100MB`

**Nguyên nhân:** Đẩy file lớn (VD: `drugbank_full.xml` ~1.7GB).

**Giải quyết:** File đó phải có trong `.gitignore` trước khi `git add`. Nếu đã lỡ stage:
```powershell
# Xóa file khỏi tracking (không xóa file thật)
git rm --cached "Back_end/Database/drugbank_full.xml"
git commit -m "chore: remove large file from tracking"
```

Sau đó kiểm tra `.gitignore` đã có dòng:
```
Back_end/Database/drugbank_full.xml
```

---

### ❌ Lỗi: `fatal: not a git repository`

**Nguyên nhân:** Chưa chạy `git init` hoặc đang ở sai thư mục.

**Giải quyết:**
```powershell
cd D:\Du_an
git init
```

---

### ❌ File `.env` bị push lên GitHub

**Khắc phục ngay:**
```powershell
git rm --cached ".env"
git rm --cached "Back_end/Clinical Decision Support System - cintana/.env"
git commit -m "security: remove .env from tracking"
git push origin main
```

> Sau đó **rotate tất cả secrets** (đổi mật khẩu DB, secret key) vì đã lộ ra public.

---

## Tóm tắt nhanh — Checklist lần đầu

- [ ] Cài Git và cấu hình `user.name`, `user.email`  
- [ ] Tạo Personal Access Token trên GitHub  
- [ ] Tạo repository mới trên GitHub (không init README)  
- [ ] `cd D:\Du_an` → `git init`  
- [ ] Kiểm tra `.gitignore` đã loại trừ: `.venv/`, `node_modules/`, `.env`, `drugbank_full.xml`  
- [ ] `git add .` → `git commit -m "feat: initial commit"`  
- [ ] `git remote add origin <URL>`  
- [ ] `git push -u origin main`  
- [ ] Cài extension **GitLens** trong VS Code (tuỳ chọn nhưng rất hữu ích)

---

*Tài liệu này áp dụng cho dự án MediDB tại `D:\Du_an`*
