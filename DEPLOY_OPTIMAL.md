# Phương Án Deploy Tối Ưu — Còn 1 Tháng Báo Cáo

## Kết Luận Ngay

| | VPS + Nginx (bài trước) | **Vercel + Railway** ✅ |
|--|------------------------|------------------------|
| Thời gian setup | 1–2 ngày | **2–4 tiếng** |
| Cần biết Linux/SSH | Có | Không |
| Auto deploy khi push git | Phải tự cấu hình CI/CD | **Có sẵn** |
| Chi phí | ~100–150k/tháng | **Miễn phí** (đủ demo) |
| SSL tự động | Phải cài certbot | **Có sẵn** |
| Custom domain | Có | **Có (miễn phí trên Vercel)** |
| Phù hợp báo cáo 1 tháng | Rủi ro, tốn thời gian | ✅ **Tối ưu** |

---

## Kiến Trúc Đề Xuất

```
yourdomain.com  (Vercel — miễn phí)
     │
     ├── /           → React SPA (Vercel CDN)
     └── /api/*      → Rewrite → api.yourdomain.com (Railway)

api.yourdomain.com  (Railway — miễn phí $5 credit/tháng)
     │
     ├── FastAPI / Uvicorn   (Railway Web Service)
     └── MySQL 8.0           (Railway MySQL Plugin)
```

**Tại sao phương án này tối ưu:**
- Dự án đã có sẵn `vercel.json` → frontend gần như không cần thêm gì
- Frontend dùng `const BASE = '/api/v1'` (relative path) → chỉ cần thêm rewrite trong vercel.json
- Railway hỗ trợ Python + MySQL addon, tự đọc `requirements.txt` và `Procfile` (đã có sẵn trong project)
- Không cần quản lý server, không lo reboot, không lo cài đặt

---

## Thay Đổi Code — Chỉ 2 File

### 1. `Front-end/vercel.json` — Thêm proxy /api → Railway
```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://api.yourdomain.com/api/:path*"
    },
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```
> Thay `api.yourdomain.com` bằng URL Railway thực tế (dạng `xxx.up.railway.app`)

### 2. `Front-end/vite.config.ts` — Bỏ base GitHub Pages
```typescript
// TRƯỚC (cho GitHub Pages)
base: command === 'build' ? '/DrugHome/' : '/',

// SAU (cho domain riêng)
base: '/',
```

### 3. `Back_end/.env` — Tạo file .env production trên Railway (qua Dashboard, không commit)
```env
DEBUG=false
DB_HOST=<railway_mysql_host>
DB_PORT=<railway_mysql_port>
DB_NAME=railway
DB_USER=root
DB_PASSWORD=<railway_tự_sinh>
SECRET_KEY=<random_64_chars>
```
> Railway tự inject biến môi trường MySQL khi bạn thêm MySQL plugin — copy từ Railway Dashboard

---

## Các Bước Triển Khai (~3 Tiếng)

### Bước 1: Push code lên GitHub (15 phút)
```bash
# Đảm bảo .env KHÔNG có trong git
echo ".env" >> .gitignore
git add .
git commit -m "prepare for production deploy"
git push origin main
```

### Bước 2: Deploy Backend lên Railway (45 phút)
1. Vào **railway.app** → Sign in bằng GitHub
2. **New Project** → **Deploy from GitHub repo** → chọn repo
3. Chọn thư mục `Back_end/Clinical Decision Support System - cintana`
4. Railway tự nhận `Procfile` → tự chạy `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. **Add Plugin** → chọn **MySQL** → Railway tạo database, tự inject biến môi trường
6. Vào **Variables** → thêm các biến còn lại (`SECRET_KEY`, `DEBUG=false`, v.v.)
7. Chạy migrations: **Railway CLI** hoặc qua Deploy → Run Command:
   ```
   alembic upgrade head
   ```
8. Kiểm tra: `https://xxx.up.railway.app/api/docs` → Swagger hiện lên là OK

### Bước 3: Mua Domain + Cấu Hình (30 phút)
- Mua tên miền `.io.vn` (rẻ nhất, ~90k/năm) hoặc `.vn` (~250k/năm) tại **Tino.vn** hoặc **PA Vietnam**
- Vào DNS Manager của nhà cung cấp domain:
  ```
  CNAME  @    cname.vercel-dns.com   (Vercel hướng dẫn khi add domain)
  CNAME  api  xxx.up.railway.app     (subdomain cho backend)
  ```

### Bước 4: Deploy Frontend lên Vercel (30 phút)
1. Vào **vercel.com** → Sign in bằng GitHub
2. **Import Project** → chọn repo → chọn thư mục `Front-end`
3. Vercel tự nhận Vite, tự chạy `npm run build`
4. **Settings** → **Domains** → thêm `yourdomain.com`
5. SSL tự động cấp, không cần làm gì thêm

### Bước 5: Cập Nhật vercel.json với URL Railway Thực (10 phút)
```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://xxx.up.railway.app/api/:path*"
    },
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```
Push lên git → Vercel tự deploy lại trong 1 phút.

### Bước 6: Kiểm Tra Toàn Bộ (30 phút)
- [ ] `https://yourdomain.com` → React load OK
- [ ] `https://yourdomain.com/api/docs` → Swagger UI hiện
- [ ] Tìm kiếm thuốc → trả về dữ liệu từ MySQL
- [ ] Đăng nhập/đăng xuất → JWT hoạt động
- [ ] Phân tích tương tác → engine hoạt động

---

## Chi Phí Thực Tế

| Dịch vụ | Gói | Giá |
|---------|-----|-----|
| **Vercel** | Hobby (Free) | **$0** |
| **Railway** | Starter ($5 credit/tháng) | **$0** trong 1 tháng demo |
| **Tên miền** | `.io.vn` 1 năm | ~90.000 VNĐ |
| **SSL** | Let's Encrypt (Vercel tích hợp) | **$0** |
| **Tổng 1 tháng báo cáo** | | **~90.000 VNĐ** |

> Railway Starter plan cho $5 credit/tháng miễn phí. Với 1 FastAPI service + MySQL nhỏ, $5 đủ dùng khoảng 300-500 giờ compute — dư sức cho 1 tháng báo cáo.

---

## Lưu Ý Quan Trọng

### Về Database
Railway MySQL là database nhỏ (~1GB free). Nếu file `drugbank_full.xml` cần import toàn bộ thì nên:
- Import chỉ subset dữ liệu cần thiết cho demo
- Hoặc nâng Railway lên $10/tháng nếu cần nhiều hơn

### Về CORS
File `main.py` đã có: `allow_origins=["*"] if settings.debug else []`  
→ **Phải set `DEBUG=false` trên Railway**, sau đó thêm biến:
```env
ALLOWED_ORIGINS=https://yourdomain.com
```
Và sửa code trong `main.py`:
```python
# Thay dòng allow_origins
allow_origins=["*"] if settings.debug else [settings.allowed_origins],
```

### Về Procfile
Procfile hiện tại dùng `$PORT` — Railway inject port tự động, hoàn toàn tương thích, không cần sửa.

---

## Timeline Thực Hiện

```
Ngày 1 (2-4 tiếng):
  ├── Push code lên GitHub
  ├── Tạo tài khoản Railway + deploy backend
  └── Kiểm tra /api/docs chạy được

Ngày 2 (1-2 tiếng):
  ├── Mua domain
  ├── Deploy Vercel frontend
  ├── Cấu hình DNS + vercel.json
  └── Test toàn bộ luồng

Còn lại ~28 ngày: Tập trung hoàn thiện tính năng và chuẩn bị báo cáo
```
