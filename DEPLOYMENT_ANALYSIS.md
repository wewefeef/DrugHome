# Phân Tích Triển Khai Dự Án Lên Host + Tên Miền

> **Dự án:** Clinical Decision Support System (CDSS)  
> **Stack hiện tại:** FastAPI + Uvicorn (backend) · React + Vite (frontend) · MySQL (database)  
> **Mục tiêu:** Gõ tên miền → web chạy ngay, tự động, không thủ công

---

## 1. Tại Sao XAMPP Không Phải Lựa Chọn Tốt Cho Dự Án Này

XAMPP (Apache + MySQL + PHP) được thiết kế cho **ứng dụng PHP**, không phải Python/FastAPI.

| Vấn đề | Chi tiết |
|--------|----------|
| **Apache không hỗ trợ ASGI** | FastAPI chạy qua Uvicorn (ASGI server). Để Apache chạy được Python cần cấu hình `mod_wsgi` hoặc `mod_proxy` rất phức tạp |
| **Không phải production-ready** | XAMPP không có systemd service management → backend tắt khi server reboot, không tự khởi động lại |
| **Bảo mật yếu** | XAMPP mặc định bật phpMyAdmin, nhiều cổng mở, không phù hợp môi trường public |
| **Nặng và dư thừa** | XAMPP cài thêm PHP, Perl, phpMyAdmin — những thứ dự án này không cần |
| **Khó scale** | Không hỗ trợ load balancing hay worker management cho ASGI |

**Kết luận:** Dùng XAMPP cho dự án này là đi ngược lại thiết kế của XAMPP. Sẽ mất nhiều thời gian workaround mà kết quả vẫn không ổn định.

---

## 2. Phương Án Đề Xuất: VPS + Nginx + Systemd

### Kiến Trúc Tổng Thể

```
Internet
    │
    ▼ yourdomain.com (port 443 HTTPS / port 80 → redirect HTTPS)
┌─────────────────────────────────────────┐
│              NGINX (Web Server)          │
│                                         │
│  /           → React build (static)     │
│  /api/*      → proxy → Uvicorn :8000    │
│  /admin/*    → proxy → Uvicorn :8000    │
│  /api/docs   → proxy → Uvicorn :8000    │
└──────────────────┬──────────────────────┘
                   │ localhost only
                   ▼
         ┌─────────────────┐
         │  FastAPI/Uvicorn │  (port 8000, internal)
         │  (systemd svc)  │
         └────────┬────────┘
                  │
                  ▼
         ┌─────────────────┐
         │   MySQL 8.0      │  (port 3306, localhost only)
         └─────────────────┘
```

**Tại sao Nginx?**
- Reverse proxy hoàn hảo cho Uvicorn/ASGI
- Phục vụ file tĩnh React build cực nhanh (không qua Python)
- Tích hợp Let's Encrypt SSL dễ dàng
- Nhẹ, hiệu suất cao, industry standard cho FastAPI
- Xử lý concurrent connections tốt hơn Apache

---

## 3. Lựa Chọn Hosting

### Tiêu Chí Tối Thiểu Cho Dự Án Này
- RAM: ≥ 1 GB (FastAPI + MySQL + Nginx)
- Disk: ≥ 20 GB (database DrugBank khá lớn)
- OS: Ubuntu 22.04 LTS (khuyến nghị)
- Băng thông: Không giới hạn hoặc ≥ 1 TB/tháng

### Nhà Cung Cấp VPS Trong Nước (Phù Hợp Nếu User Ở VN)

| Nhà cung cấp | Gói phù hợp | Giá/tháng | Ghi chú |
|-------------|------------|-----------|---------|
| **Azdigi** | VPS Basic (1 vCPU, 1GB RAM) | ~99.000 VNĐ | Datacenter VN, hỗ trợ tiếng Việt |
| **TinoHost** | VPS SSD (1 vCPU, 1GB RAM) | ~89.000 VNĐ | Phổ biến tại VN |
| **VinaHost** | VPS Linux (1 vCPU, 2GB RAM) | ~150.000 VNĐ | Ổn định, lâu năm |
| **PA Vietnam** | Cloud VPS | ~120.000 VNĐ | Có hỗ trợ 24/7 |
| **Matbao** | VPS Linux | ~110.000 VNĐ | |

### Nhà Cung Cấp VPS Quốc Tế (Nếu Muốn Tốc Độ Quốc Tế)

| Nhà cung cấp | Gói phù hợp | Giá/tháng | Ghi chú |
|-------------|------------|-----------|---------|
| **DigitalOcean** | Droplet Basic (1 vCPU, 1GB RAM) | $6 USD | Dễ dùng, nhiều tutorial |
| **Vultr** | Cloud Compute (1 vCPU, 1GB RAM) | $6 USD | Datacenter Singapore (gần VN) |
| **Linode/Akamai** | Nanode (1 vCPU, 1GB RAM) | $5 USD | Ổn định |
| **Hetzner** | CX11 (1 vCPU, 2GB RAM) | €4.15 EUR | Rẻ nhất, datacenter EU |

> **Khuyến nghị:** Nếu user chủ yếu là VN → chọn VPS trong nước (Azdigi/TinoHost) để tốc độ tốt hơn.  
> Nếu demo quốc tế → Vultr Singapore hoặc DigitalOcean.

### Tên Miền
- **.vn** (~250.000 VNĐ/năm) tại PA Vietnam, Matbao, VinaHost
- **.com** (~300.000 VNĐ/năm) tại Namecheap, GoDaddy, hoặc cùng nhà với VPS

---

## 4. Thay Đổi Cần Thiết Trong Code

### 4.1 Frontend — vite.config.ts
```typescript
// HIỆN TẠI (chỉ dùng cho GitHub Pages)
base: command === 'build' ? '/DrugHome/' : '/',

// SAU KHI CÓ DOMAIN (thay bằng)
base: '/',
```

### 4.2 Frontend — API endpoint
Hiện tại frontend gọi API qua proxy localhost. Khi deploy cần chỉnh file `src/lib/api.ts` để trỏ đúng domain:
```typescript
// Không cần thay đổi nếu dùng Nginx proxy /api → backend
// Nginx sẽ xử lý việc này trong suốt với frontend
```

### 4.3 Backend — .env (môi trường production)
```env
# File .env trên server (KHÔNG commit lên git)
DEBUG=false
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=cdss_db
DB_USER=cdss_user
DB_PASSWORD=<mật_khẩu_mạnh>
SECRET_KEY=<random_64_chars>
ALLOWED_ORIGINS=https://yourdomain.com
```

### 4.4 Backend — CORS (app/main.py)
```python
# Thay origins từ localhost sang domain thực
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://yourdomain.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## 5. Quy Trình Triển Khai (Step-by-Step)

### Bước 1: Chuẩn Bị Server
```bash
# Kết nối SSH vào VPS
ssh root@<IP_VPS>

# Cập nhật hệ thống
apt update && apt upgrade -y

# Cài đặt các gói cần thiết
apt install -y python3.11 python3.11-venv python3-pip nginx mysql-server certbot python3-certbot-nginx git
```

### Bước 2: Cấu Hình MySQL
```bash
mysql_secure_installation

mysql -u root -p
CREATE DATABASE cdss_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'cdss_user'@'localhost' IDENTIFIED BY 'MatKhauManh123!';
GRANT ALL PRIVILEGES ON cdss_db.* TO 'cdss_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### Bước 3: Upload và Cấu Hình Backend
```bash
# Clone project hoặc upload qua scp/FTP
git clone https://github.com/your-repo/cdss.git /var/www/cdss

# Cài venv và dependencies
cd /var/www/cdss/Back_end/Clinical\ Decision\ Support\ System\ -\ cintana
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Tạo file .env production
nano .env  # điền DB credentials và SECRET_KEY

# Chạy migrations
alembic upgrade head
```

### Bước 4: Tạo Systemd Service (Auto-start Backend)
```ini
# /etc/systemd/system/cdss-backend.service
[Unit]
Description=CDSS FastAPI Backend
After=network.target mysql.service

[Service]
User=www-data
WorkingDirectory=/var/www/cdss/Back_end/Clinical Decision Support System - cintana
ExecStart=/var/www/cdss/Back_end/Clinical Decision Support System - cintana/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2
Restart=always
RestartSec=3
Environment=PYTHONPATH=/var/www/cdss/Back_end/Clinical Decision Support System - cintana

[Install]
WantedBy=multi-user.target
```
```bash
systemctl daemon-reload
systemctl enable cdss-backend
systemctl start cdss-backend
systemctl status cdss-backend  # kiểm tra đang chạy
```

### Bước 5: Build Frontend
```bash
cd /var/www/cdss/Front-end

# Cài Node.js nếu chưa có
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

npm install
npm run build  # tạo thư mục dist/

# Copy dist ra thư mục web
cp -r dist/ /var/www/html/cdss-frontend/
```

### Bước 6: Cấu Hình Nginx
```nginx
# /etc/nginx/sites-available/cdss
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Frontend - React SPA (serve static files)
    root /var/www/html/cdss-frontend;
    index index.html;

    # API requests → proxy to FastAPI
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Admin UI → proxy to FastAPI
    location /admin/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Frontend SPA routing (React Router)
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```
```bash
ln -s /etc/nginx/sites-available/cdss /etc/nginx/sites-enabled/
nginx -t          # kiểm tra cú pháp
systemctl reload nginx
```

### Bước 7: Cài SSL Miễn Phí (Let's Encrypt)
```bash
certbot --nginx -d yourdomain.com -d www.yourdomain.com
# Certbot tự động cấu hình HTTPS và redirect HTTP → HTTPS
# SSL tự gia hạn mỗi 90 ngày
```

### Bước 8: Trỏ DNS
Tại nhà cung cấp tên miền, thêm record:
```
Type: A    Name: @      Value: <IP_VPS>   TTL: 3600
Type: A    Name: www    Value: <IP_VPS>   TTL: 3600
```

---

## 6. So Sánh Các Lựa Chọn Web Server

| | **XAMPP** | **Nginx** ✅ | **Apache + mod_wsgi** | **Caddy** |
|--|-----------|------------|----------------------|-----------|
| Hỗ trợ FastAPI/ASGI | ❌ Phức tạp | ✅ Native proxy | ⚠️ Cần config nhiều | ✅ Native |
| Phục vụ file tĩnh | ✅ | ✅ Rất nhanh | ✅ | ✅ |
| Auto SSL | ❌ | ✅ Certbot | ✅ Certbot | ✅ Tự động |
| Systemd integration | ❌ | ✅ | ✅ | ✅ |
| Độ khó cài đặt | Dễ (local) | Trung bình | Khó | Dễ |
| Phù hợp production | ❌ | ✅ | ✅ | ✅ |
| Tài liệu FastAPI | Không có | Rất nhiều | Ít | Nhiều |

**Đề xuất thứ 2 (nếu muốn còn đơn giản hơn Nginx):** **Caddy** — tự động cấp SSL, cú pháp config đơn giản hơn, nhưng ít tài liệu tiếng Việt hơn.

---

## 7. Tóm Tắt Phương Án Tối Ưu

```
✅ VPS Ubuntu 22.04 (Azdigi ~99k/tháng hoặc Vultr $6/tháng)
✅ Nginx (reverse proxy + static files)
✅ Uvicorn chạy qua systemd (tự khởi động lại)
✅ MySQL 8.0 (cài trực tiếp trên VPS)
✅ Let's Encrypt SSL (miễn phí, tự gia hạn)
✅ Tên miền .vn hoặc .com (~250-300k/năm)
```

**Chi phí ước tính:**
- VPS: ~100.000 - 150.000 VNĐ/tháng
- Tên miền: ~250.000 - 300.000 VNĐ/năm
- SSL: **Miễn phí** (Let's Encrypt)
- **Tổng:** ~1.5 - 2 triệu VNĐ/năm

**Kết quả:** Gõ `https://yourdomain.com` → React frontend load ngay · Tất cả API gọi đến `/api/*` tự chuyển qua Nginx đến FastAPI · MySQL chỉ lắng nghe nội bộ · Backend tự khởi động lại khi server reboot.

---

## 8. Lưu Ý Quan Trọng Trước Khi Deploy

- [ ] Đổi `DEBUG=false` trong `.env` production
- [ ] Đổi `SECRET_KEY` thành giá trị ngẫu nhiên mạnh (64 ký tự+)
- [ ] Thay `base: '/'` trong `vite.config.ts` (bỏ `/DrugHome/`)
- [ ] Cập nhật `ALLOWED_ORIGINS` trong CORS chỉ cho phép domain thực
- [ ] Backup database trước mỗi lần deploy
- [ ] Không commit file `.env` lên git (đảm bảo có trong `.gitignore`)
- [ ] Mở chỉ port 80, 443, 22 trên firewall (`ufw allow 80 443 22`)
- [ ] MySQL không mở ra ngoài (chỉ localhost)
