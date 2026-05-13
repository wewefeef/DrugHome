# MediDB — Clinical Decision Support System
### Tài liệu kỹ thuật toàn bộ dự án · Cập nhật: 13/05/2026 (Sprint 8)

---
Invoke-WebRequest -Uri "http://127.0.0.1:8000/admin/login" -UseBasicParsing | Select-Object StatusCode

cd C:\cdss
git pull origin main
Stop-ScheduledTask -TaskName "CDSS-Backend"
Start-ScheduledTask -TaskName "CDSS-Backend"


## Mục lục
1. [Tổng quan hệ thống](#1-tổng-quan-hệ-thống)
2. [Công nghệ sử dụng](#2-công-nghệ-sử-dụng)
3. [Cấu trúc Back-end](#3-cấu-trúc-back-end)
4. [Cấu trúc Front-end](#4-cấu-trúc-front-end)
5. [Cách khởi động chương trình](#5-cách-khởi-động-chương-trình)
6. [Luồng đi của hệ thống](#6-luồng-đi-của-hệ-thống)
7. [Sơ đồ ERD — 14-Table Schema](#7-sơ-đồ-erd--14-table-schema)
8. [Tham chiếu Truy vấn MySQL](#8-tham-chiếu-truy-vấn-mysql)

---

## 1. Tổng quan hệ thống

**MediDB** là nền tảng hỗ trợ quyết định lâm sàng (CDSS) về tương tác thuốc, xây dựng trên dữ liệu DrugBank v5.

- **17,430 thuốc** — đầy đủ thông tin dược lý, hóa học, cơ chế tác dụng
- **2,855,848 cặp tương tác thuốc-thuốc** — mức độ major/moderate/minor/unknown
- **5,206 protein/enzyme/transporter** với **33,227 liên kết thuốc-protein**
- **462,594 sản phẩm thương mại** (brand names) — FDA NDC, DPD, EMA
- **16 bảng MySQL** — chuẩn hoá hoàn toàn với quan hệ FK chặt chẽ

Người dùng có thể tìm kiếm thuốc, kiểm tra tương tác đa thuốc, xem mạng lưới protein, lưu lịch sử phân tích và xem thống kê cá nhân.

---

## 2. Công nghệ sử dụng

### Frontend
- React 19, TypeScript ~6.0, Vite 8
- Tailwind CSS v3, Lucide React (icons)
- React Router DOM v7 (client-side routing)
- react-force-graph-2d (network visualization)

### Backend
- Python 3.11, FastAPI, Uvicorn (ASGI server)
- SQLAlchemy 2.0 (ORM), PyMySQL (MySQL driver)
- Alembic (database migrations)
- python-jose + bcrypt (JWT auth + password hashing)
- pydantic-settings (config từ .env)
- sqladmin (Admin UI tại /admin/)
- fastapi-cache2 (in-memory cache TTL-based)

### Database & Hạ tầng
- MySQL 8 (database server — local hoặc VPS)
- IIS (Windows) — serve static frontend build + ARR reverse proxy
- VPS Windows Server — chạy uvicorn backend + IIS

---

## 3. Cấu trúc Back-end

```
Back_end/
├── Clinical Decision Support System - cintana/   ← Root của FastAPI app
│   │
│   ├── .env                        ← Biến môi trường (DB, SECRET_KEY) — KHÔNG push git
│   ├── requirements.txt            ← Toàn bộ Python dependencies
│   ├── alembic.ini                 ← Config Alembic migrations
│   │
│   ├── app/                        ← Source code Python chính
│   │   ├── main.py                 ← Entry point của FastAPI app
│   │   │                              Khởi tạo app, đăng ký CORS middleware, mount tất cả routers,
│   │   │                              chạy Base.metadata.create_all() khi start,
│   │   │                              sửa schema tự động (_repair_schema_if_needed)
│   │   │
│   │   ├── config.py               ← Đọc cấu hình từ .env bằng pydantic-settings
│   │   │                              Tạo DATABASE_URL từ DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD
│   │   │                              Tự động encode ký tự đặc biệt trong password (urllib.parse.quote_plus)
│   │   │
│   │   ├── database.py             ← Khởi tạo SQLAlchemy engine + SessionLocal
│   │   │                              Định nghĩa hàm get_db() — FastAPI Dependency injection
│   │   │                              Mỗi HTTP request nhận 1 Session riêng, tự đóng sau khi xong
│   │   │
│   │   ├── models.py               ← 16 ORM models ánh xạ sang 16 bảng MySQL
│   │   │                              Drug, Protein, DrugInteraction, DrugProteinInteraction,
│   │   │                              DrugGroup, DrugCategory, DrugSynonym, DrugProduct,
│   │   │                              DrugExternalIdentifier, DrugCalculatedProperty,
│   │   │                              DrugGroupMap, DrugCategoryMap, User, AnalysisSession,
│   │   │                              DrugFoodInteraction (tương tác thức ăn), DrugDosage (liều dùng)
│   │   │
│   │   ├── schemas.py              ← Pydantic schemas (request body + response shape)
│   │   │                              DrugOut, PaginatedResponse, CheckInteractionsRequest,
│   │   │                              CheckInteractionsResponse, RiskScoreResult, ...
│   │   │
│   │   ├── admin.py                ← sqladmin ModelViews — giao diện quản trị tại /admin/
│   │   │                              DrugAdmin: danh sách + chi tiết + thêm/sửa thuốc
│   │   │                              Inline editing: Synonyms, Products, FoodInteractions, Dosages
│   │   │                              DrugInteractionAdmin, ProteinAdmin, UserAdmin, AnalysisSessionAdmin
│   │   │                              DrugSynonymAdmin, DrugProductAdmin, DrugExternalIdentifierAdmin
│   │   │                              DrugCalculatedPropertyAdmin, DrugFoodInteractionAdmin, DrugDosageAdmin
│   │   │
│   │   ├── core/                   ← 3 engine phân tích lâm sàng
│   │   │   ├── interaction_engine.py
│   │   │   │       Nhận list DrugBank ID → query bảng drug_interactions (bidirectional)
│   │   │   │       Trả về danh sách cặp tương tác, severity, mô tả
│   │   │   │
│   │   │   ├── risk_engine.py
│   │   │   │       Tính điểm rủi ro 0–10 dựa trên severity + shared CYP enzyme + shared target
│   │   │   │       major×4 + moderate×2 + minor×0.5 + shared_CYP×1.0 + shared_target×0.5
│   │   │   │       → risk_level: low / moderate / high / critical
│   │   │   │
│   │   │   ├── recommendation_engine.py
│   │   │   │       Gợi ý lâm sàng dựa trên risk level + severity distribution
│   │   │   │       Trả về danh sách recommendation text theo context
│   │   │   │
│   │   │   └── simple_cache.py
│   │   │           Dict-based in-memory cache với TTL (mặc định 300s)
│   │   │           cache_get / cache_set / cache_delete / cache_delete_prefix
│   │   │
│   │   └── routers/                ← HTTP route handlers
│   │       ├── api_auth.py         POST /register, POST /login, GET /me
│   │       │                       JWT HS256, expire 7 ngày, bcrypt password hash
│   │       │
│   │       ├── api_drugs.py        GET /api/v1/drugs — list/search thuốc (paginated)
│   │       │                       GET /api/v1/drugs/{id} — chi tiết 1 thuốc
│   │       │                       GET /api/v1/drugs/{id}/network — mạng lưới protein
│   │       │                       GET /api/v1/drugs/categories/{key} — theo nhóm bệnh
│   │       │                       FULLTEXT search trên MySQL MATCH...AGAINST
│   │       │
│   │       ├── api_substances.py   GET /api/v1/substances — list/search protein (paginated)
│   │       │                       GET /api/v1/substances/{id} — chi tiết 1 protein
│   │       │
│   │       ├── api_interactions.py GET /api/v1/interactions — list tương tác
│   │       │                       GET /api/v1/interactions/drug/{id} — tương tác của 1 thuốc
│   │       │
│   │       ├── api_analysis.py     POST /api/v1/analysis/check-interactions
│   │       │                       POST /api/v1/analysis/risk-score
│   │       │                       POST /api/v1/analysis/recommendations
│   │       │                       Gọi 3 engine trong core/
│   │       │
│   │       ├── api_sessions.py     POST/GET/PATCH/DELETE /api/v1/sessions
│   │       │                       Toàn bộ yêu cầu JWT Bearer token
│   │       │                       Mỗi user chỉ thấy phiên của chính mình
│   │       │
│   │       └── drugs.py            Legacy — HTML Jinja2 routes (không dùng trong React app)
│   │
│   ├── alembic/
│   │   ├── env.py                  Kết nối Alembic với SQLAlchemy engine
│   │   └── versions/
│   │       ├── 0002_add_performance_indexes.py  Thêm FULLTEXT + composite indexes
│   │       ├── 0003_add_user_id_to_sessions.py  Thêm cột user_id FK vào analysis_sessions
│   │       └── 0004_normalize_14_tables.py      Tạo 12 bảng normalized (groups, categories, ...)
│   │
│   ├── scripts/                    ← Pipeline nhập dữ liệu từ DrugBank XML
│   │   ├── xml_to_json.py          Bước 1: parse drugbank_full.xml (~1.7GB) → 4 NDJSON files
│   │   │                              (trích xuất <products> brand names vào drugs.ndjson)
│   │   ├── json_to_mysql.py        Bước 2: import NDJSON → MySQL (drugs, proteins, interactions)
│   │   ├── import_normalized_data.py  Bước 3: bổ sung 16 bảng normalized + cập nhật pharmacology
│   │   ├── import_products_from_xml.py  Standalone: stream XML → nhập trực tiếp vào drug_products
│   │   │                              Dùng khi drug_products trống — không cần chạy lại toàn pipeline
│   │   │                              python -m scripts.import_products_from_xml --xml <path>
│   │   ├── seed_normalized.py      Seed dữ liệu nhỏ để test
│   │   └── load_drugbank.py        CLI Typer — chạy toàn bộ pipeline (legacy)
│   │
│   ├── seed_data/
│   │   ├── proteins.ndjson         5,206 protein (dùng cho auto-seed khi startup)
│   │   └── drug_protein_interactions.ndjson  33,227 liên kết (dùng cho auto-seed)
│   │
│   └── utils/
│       ├── _check_db.py            Kiểm tra DB health (counts, version, charset)
│       └── _repair_db.py           Sửa data lỗi (duplicates, encoding issues)
│
└── Database/
    ├── drugbank_full.xml           DrugBank v5 XML gốc (~1.7GB) — gitignored
    └── data/
        ├── drugs.ndjson            17,430 thuốc
        ├── drug_interactions.ndjson  2,855,848 tương tác
        ├── proteins.ndjson         5,206 protein
        └── drug_protein_interactions.ndjson
```

---

## 4. Cấu trúc Front-end

```
frontend/                           ← Tên folder trên VPS (tương đương Front-end/ local)
│
├── index.html                      ← HTML gốc, mount vào <div id="root">
├── vite.config.ts                  ← Cấu hình Vite: proxy /api/* → localhost:8000 (dev only)
├── tailwind.config.js              ← Custom colors (primary palette), font
├── tsconfig.json                   ← TypeScript config
├── package.json                    ← Dependencies + scripts (dev, build, lint)
│
├── public/
│   └── data/
│       ├── drugs.json              17,430 thuốc (~13MB) — load tĩnh, không qua API
│       ├── proteins.json           5,206 protein (~967KB) — load tĩnh, không qua API
│       └── drug_categories.json   13 nhóm bệnh × 20 thuốc — dùng cho InteractionsPage
│
└── src/
    ├── main.tsx                    Entry point — ReactDOM.createRoot → render <App/>
    ├── App.tsx                     Định nghĩa tất cả routes, bọc AuthProvider + BrowserRouter
    │                               Routes: / /drugs /drugs/:id /interactions /proteins /analysis /resources /login /register
    │
    ├── index.css                   Tailwind directives (@tailwind base/components/utilities)
    │                               CSS custom properties (--primary, --gradient-hero, ...)
    │
    ├── types/
    │   └── drug.ts                 TypeScript interface Drug — dùng toàn app
    │
    ├── assets/                     Static images, logos
    │
    ├── context/
    │   └── AuthContext.tsx         Global authentication state
    │                               - State: user, token, loading
    │                               - Khởi động: đọc localStorage['medidb_token'] → verify với GET /api/v1/auth/me
    │                               - login(token, user): lưu vào localStorage + update state
    │                               - logout(): xóa localStorage + reset state
    │                               - useAuth() hook — dùng ở mọi component cần biết user
    │
    ├── lib/
    │   ├── api.ts                  Tất cả fetch call đến backend đều đi qua đây
    │   │                           - apiFetchDrugs(params) — GET /api/v1/drugs (paginated + filter)
    │   │                           - apiFetchDrug(id) — GET /api/v1/drugs/{id}
    │   │                           - apiFetchDrugNetwork(id) — GET /api/v1/drugs/{id}/network
    │   │                           - apiSearchDrugs(q) — lightweight autocomplete
    │   │                           - apiFetchProteins(params) — GET /api/v1/substances
    │   │                           - apiSearchProteins(q) — protein autocomplete
    │   │                           - apiFetchSiteStats() — đếm tổng thuốc/protein cho HomePage
    │   │                           - apiFetchDrugInteractions(id) — GET /api/v1/interactions/drug/{id}
    │   │                           - apiFetchDrugNetwork(id) — mạng lưới protein cho DrugDetailPage
    │   │
    │   ├── drugCache.ts            Singleton — load drugs.json 1 lần duy nhất, share toàn app
    │   │                           Dùng cho autocomplete và filter offline trên DrugsPage
    │   │
    │   └── proteinCache.ts         Singleton — load proteins.json 1 lần duy nhất
    │
    ├── components/
    │   ├── Header.tsx              Navigation bar — logo, menu links, search bar (autocomplete live API),
    │   │                           avatar user / nút đăng nhập, trending drugs từ localStorage
    │   │
    │   └── Footer.tsx              Footer — copyright, links tài nguyên
    │
    └── pages/
        ├── HomePage.tsx            Trang chủ
        │                           - HeroBanner: tiêu đề + trending search pills (từ localStorage)
        │                           - StatsSection: đếm live từ API (apiFetchSiteStats)
        │                           - Featured drugs section
        │                           - How it works, CTA section
        │
        ├── DrugsPage.tsx           Danh sách 17,430 thuốc
        │                           - Load từ public/data/drugs.json (không qua API)
        │                           - Filter: nhóm bệnh, drug_type, state, nhóm phê duyệt
        │                           - Search fulltext client-side hoặc server-side qua API
        │                           - Pagination 24 items/trang
        │
        ├── DrugDetailPage.tsx      Trang chi tiết 1 thuốc (/drugs/:id)
        │                           - Fetch từ API: GET /api/v1/drugs/{id} (đầy đủ pharmacology)
        │                           - Fetch mạng lưới: GET /api/v1/drugs/{id}/network
        │                           - SVG network visualization (protein nodes orbit quanh drug)
        │                           - Tabs: Overview, Pharmacology, Chemistry, Interactions, Network
        │
        ├── InteractionsPage.tsx    Drug Interaction Checker (tính năng chính)
        │                           - Sidebar trái: 13 nhóm bệnh (từ drug_categories.json)
        │                           - Chọn tối đa 8 thuốc — search live qua API
        │                           - SVG 3D visualization: viên thuốc gradient, protein orbit
        │                           - Nhấn "Check Interactions" → POST /api/v1/analysis/check-interactions
        │                           - Animation: thuốc bật xa (có tương tác) / hòa vào nhau (an toàn)
        │                           - Kết quả: severity badges, modal chi tiết từng cặp
        │                           - Lưu phiên: đăng nhập → POST /api/v1/sessions; khách → sessionStorage
        │
        ├── AnalysisPage.tsx        Lịch sử & phân tích (/analysis)
        │                           - Tab "Lịch sử": list phiên đã lưu (đăng nhập) hoặc sessionStorage (khách)
        │                           - Tab "Thống kê": số phiên, tổng tương tác, phân bố severity
        │                           - Tab "So sánh thuốc": so sánh 2 thuốc side-by-side
        │                           - SessionDetailModal: xem lại đầy đủ 1 phiên, fetch live nếu thiếu data
        │                           - Banner vàng cho khách: nhắc đăng nhập để lưu vĩnh viễn
        │
        ├── ProteinsPage.tsx        Danh sách 5,206 protein/enzyme/transporter/carrier
        │                           - Fetch từ API: GET /api/v1/substances (paginated)
        │                           - Filter: protein_type, organism
        │                           - Search real-time
        │
        ├── AuthPage.tsx            Đăng nhập / Đăng ký (full-screen, không có Header/Footer)
        │                           - Tab Login: POST /api/v1/auth/login { identifier, password }
        │                           - Tab Register: POST /api/v1/auth/register
        │                           - Lưu token vào localStorage['medidb_token'] + localStorage['medidb_user']
        │                           - Redirect về trang trước sau khi đăng nhập
        │
        └── ResourcesPage.tsx       Tài nguyên — link DrugBank, tài liệu tham khảo, about
```

---

## 5. Cách khởi động chương trình

> **Lưu ý quan trọng**: Local chạy lệnh ngay trong Terminal của VS Code. VPS chạy lệnh trên cửa sổ PowerShell của máy ảo Windows Server — **cú pháp lệnh giống nhau** nhưng phải SSH/RDP vào VPS trước.

---

### 5.1 Chạy Local (VS Code Terminal)

#### Yêu cầu
- Python 3.11+ đã cài
- Node.js 20+ đã cài
- MySQL 8 đang chạy local (port 3306)
- Database `cdss` đã tạo và import data

#### Backend — Terminal 1
```powershell
# Bước 1: Kích hoạt Python virtual environment
d:\Du_an\.venv\Scripts\Activate.ps1

# Bước 2: Di chuyển vào thư mục backend (BẮT BUỘC trước khi chạy uvicorn)
cd "D:\Du_an\Back_end\Clinical Decision Support System - cintana"

# Bước 3: Cài dependencies (chỉ lần đầu)
pip install -r requirements.txt

# Bước 4: Tạo file .env trong thư mục này (nếu chưa có)
# Nội dung .env:
#   DB_HOST=127.0.0.1
#   DB_PORT=3306
#   DB_NAME=cdss
#   DB_USER=root
#   DB_PASSWORD=your_mysql_password
#   SECRET_KEY=any-long-random-string
#   DEBUG=true

# Bước 5: Chạy server (--reload tự restart khi sửa code)
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
✅ API: `http://localhost:8000`
📖 Swagger UI: `http://localhost:8000/api/docs`
🔧 Admin panel: `http://localhost:8000/admin/`

#### Frontend — Terminal 2
```powershell
# Di chuyển vào thư mục frontend
cd D:\Du_an\frontend

# Cài dependencies (chỉ lần đầu)
npm install

# Chạy dev server
npm run dev
```
✅ Frontend: `http://localhost:5173`
> Vite tự động proxy `/api/*` → `http://localhost:8000` (cấu hình trong `vite.config.ts`)

#### Import dữ liệu ban đầu (chỉ chạy 1 lần khi setup)
```powershell
# Vẫn trong terminal Backend, venv đã kích hoạt
cd "D:\Du_an\Back_end\Clinical Decision Support System - cintana"

# Bước 1: XML → NDJSON (cần file drugbank_full.xml ~1.7GB)
python -m scripts.xml_to_json "D:/Du_an/Back_end/Database/drugbank_full.xml"

# Bước 2: NDJSON → MySQL (drugs, proteins, drug_interactions, drug_protein_interactions)
python -m scripts.json_to_mysql

# Bước 3: Import đầy đủ 14 bảng normalized (pharmacology, groups, categories, synonyms, ...)
python -m scripts.import_normalized_data

# Hoặc bỏ qua re-import 2.8M interactions nếu đã có (nhanh hơn ~10 phút):
python -m scripts.import_normalized_data --skip-interactions

# Bước 4 (nếu drug_products trống): Import 462,594 brand names từ XML
python -m scripts.import_products_from_xml
# Hoặc chỉ định đường dẫn XML cụ thể:
python -m scripts.import_products_from_xml --xml "D:/Du_an/Back_end/Database/drugbank_full.xml"
```

---

### 5.2 Chạy trên VPS (PowerShell máy ảo Windows Server)

> Đăng nhập vào VPS qua RDP hoặc SSH trước, mở PowerShell với quyền Administrator.

#### Cấu trúc thư mục trên VPS
```
C:\cdss\                        ← Git repository root
├── Back_end\                   ← Backend code
│   ├── venv\                   ← Python virtual environment (C:\cdss\Back_end\venv\)
│   ├── Database\               ← drugbank_full.xml (~1.7GB, gitignored)
│   └── Clinical Decision Support System - cintana\  ← FastAPI root
│       ├── .env                ← Cấu hình DB — KHÔNG push git
│       └── app/  scripts/  ...
├── frontend\                   ← Frontend code + build output
│   └── dist\                   ← IIS serve trực tiếp từ đây
└── .gitignore  README.md  ...
```

#### Backend — PowerShell VPS
```powershell
# Bước 1: Kích hoạt Python virtual environment trên VPS
C:\cdss\Back_end\venv\Scripts\Activate.ps1

# Bước 2: Di chuyển vào thư mục backend (BẮT BUỘC)
cd "C:\cdss\Back_end\Clinical Decision Support System - cintana"

# Bước 3: Cập nhật code mới nhất từ git
git pull origin main

# Bước 4: Cài/cập nhật dependencies
pip install -r requirements.txt

# Bước 5: Chạy production (--workers 4, KHÔNG --reload)
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 4
```
> IIS ARR (Application Request Routing) proxy `/api/*` → `http://127.0.0.1:8000`

#### Frontend — Build và deploy trên VPS
```powershell
# Cập nhật code mới nhất từ git (chạy ở root repo)
cd C:\cdss
git pull origin main

# Vào subfolder frontend và build
cd frontend
npm install   # chỉ cần khi có package mới
npm run build

# Reload IIS để nhận file mới
iisreset /noforce
```
> IIS serve trực tiếp từ `C:\cdss\frontend\dist\` — không cần copy đi đâu.
> IIS rewrite rule: tất cả request không phải file tĩnh → `index.html` (SPA routing)

---

#### ⚠️ Lưu ý quan trọng: file `web.config` trong `dist/`

IIS cần file `web.config` nằm ngay trong `C:\cdss\frontend\dist\` để hoạt động đúng. File này chứa 2 rule quan trọng:

| Rule | Mục đích |
|---|---|
| **API Proxy** | `/api/*` → `http://127.0.0.1:8000` (forward sang uvicorn FastAPI) |
| **SPA Fallback** | Mọi route không phải file tĩnh → `index.html` (React Router) |

**Nếu thiếu `web.config`:**
- Tất cả `/api/v1/*` trả về **404** — login, register, search đều hỏng
- Các route React như `/drugs`, `/interactions` bị **404** khi refresh trực tiếp

**File này KHÔNG được đặt thủ công vào `dist/`** (sẽ bị xóa sau mỗi `npm run build`).  
Thay vào đó, file đã được đặt tại `frontend/public/web.config` — Vite tự động copy toàn bộ `public/` vào `dist/` khi build.

Nội dung `frontend/public/web.config`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <!-- Proxy /api/* to FastAPI backend (uvicorn port 8000) -->
        <rule name="API Proxy" stopProcessing="true">
          <match url="^(api/.*)" />
          <action type="Rewrite" url="http://127.0.0.1:8000/{R:1}" />
        </rule>
        <!-- SPA fallback: all non-file routes → index.html (React Router) -->
        <rule name="React Routes" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
```

**Kiểm tra nhanh sau khi build:**
```powershell
# Phải trả về True — nếu False thì web.config bị mất, cần kiểm tra public/
Test-Path C:\cdss\frontend\dist\web.config
```

---

#### Workflow nhanh mỗi lần sửa code
```powershell
# --- Local (VS Code terminal) ---
git add .
git commit -m "mô tả thay đổi"
git push origin main

# --- VPS PowerShell ---
cd C:\cdss
git pull origin main
cd frontend
npm run build
iisreset /noforce
```

#### Kiểm tra backend đang chạy (VPS)
```powershell
# Xem process uvicorn
Get-Process -Name python | Select-Object Id, CPU, WorkingSet

# Test API health
Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/v1/drugs?per_page=1" -UseBasicParsing
```

---

## 6. Luồng đi của hệ thống

> Phần này mô tả chi tiết cách dữ liệu được lưu trữ, đọc, truyền và hiển thị — từ database đến màn hình người dùng.

---

### 6.1 Nơi lưu trữ dữ liệu

**Database MySQL** (`cdss`) chạy trên máy local (port 3306) hoặc VPS MySQL Server.
Toàn bộ dữ liệu dược lý được lưu trong **16 bảng quan hệ**:

| Bảng | Số dòng (VPS) | Nội dung |
|---|---|---|
| `drugs` | 17,430 | Thuốc — thông tin hóa học, dược lý, cơ chế tác dụng |
| `drug_interactions` | 2,855,848 | Tương tác thuốc-thuốc (có cột `drug_name`) |
| `proteins` | 5,206 | Protein target / enzyme / transporter / carrier |
| `drug_protein_interactions` | 33,227 | Liên kết thuốc ↔ protein |
| `drug_products` | 462,594 | Sản phẩm thương mại / brand names |
| `drug_synonyms` | ~76,000 | Tên đồng nghĩa, INN, tên IUPAC |
| `drug_external_identifiers` | ~150,000 | Cross-ref PubChem / ChEMBL / KEGG |
| `drug_calculated_properties` | ~120,000 | logP, pKa, Water Solubility, Mol. Weight |
| `drug_group_map` | ~28,000 | Junction: drugs ↔ nhóm phê duyệt |
| `drug_category_map` | ~160,000 | Junction: drugs ↔ nhóm bệnh |
| `groups` | 6 | Nhóm phê duyệt (approved, experimental, withdrawn, ...) |
| `categories` | ~5,000 | Nhóm bệnh theo MeSH |
| `drug_food_interactions` | 0* | Tương tác thức ăn / đồ uống |
| `drug_dosages` | 0* | Liều dùng theo dạng và đường dùng |
| `users` | — | Tài khoản người dùng (password bcrypt hash) |
| `analysis_sessions` | — | Lịch sử phiên phân tích của mỗi user |

> `*` Bảng mới — tạo tự động khi backend start, nhập thủ công qua Admin panel.

---

### 6.2 Luồng khởi động Backend (startup sequence)

Mỗi lần backend start (`uvicorn app.main:app`), hệ thống chạy theo thứ tự sau:

```
uvicorn start
  │
  ▼
@asynccontextmanager lifespan(app):
  │
  ├─► 1. FastAPICache.init(InMemoryBackend)
  │       Khởi tạo in-memory cache TTL 300s
  │       Dùng cho các endpoint đọc nhiều (drug list, protein list)
  │
  ├─► 2. Base.metadata.create_all(engine)
  │       Tạo bảng MySQL mới nếu chưa tồn tại — KHÔNG alter bảng đã có
  │       → drug_food_interactions, drug_dosages được tạo ở đây nếu chưa có
  │
  ├─► 3. _repair_schema_if_needed()       ← idempotent, an toàn gọi nhiều lần
  │       Phát hiện và tự sửa các schema cũ không tương thích:
  │       ├─ Thêm cột drugs.smiles / inchi / average_mass nếu thiếu
  │       ├─ Migrate drug_protein_interactions: drug_code → drug_id (schema cũ)
  │       ├─ Migrate drug_interactions: drug_code → drug_id (schema cũ)
  │       ├─ Chuẩn hoá collation utf8mb4_unicode_ci trên drug_id
  │       ├─ Thêm cột users.is_admin / last_login / last_token nếu thiếu
  │       ├─ Thêm cột drug_interactions.drug_name nếu thiếu
  │       └─ Backfill drug_name NULL:
  │             UPDATE drug_interactions di
  │             JOIN drugs d ON d.drugbank_id = di.drug_id
  │             SET di.drug_name = d.name
  │             WHERE di.drug_name IS NULL
  │
  └─► 4. _run_seed_if_empty()
          Kiểm tra proteins + drug_protein_interactions — nếu trống thì tự seed:
          ├─ proteins: INSERT từ seed_data/proteins.ndjson (5,206 dòng)
          └─ drug_protein_interactions: INSERT từ seed_data/drug_protein_interactions.ndjson

FastAPI sẵn sàng nhận request
```

**Tại sao cần `_repair_schema_if_needed()`?**
`create_all()` chỉ tạo bảng mới — không bao giờ ALTER bảng đã tồn tại. Vì vậy mọi thay đổi cột (thêm cột, đổi tên) đều phải được xử lý thủ công trong hàm này. Mỗi bước đều kiểm tra trước khi thực hiện — gọi nhiều lần không gây lỗi.

---

### 6.3 Backend kết nối Database như thế nào

**File chứng minh: `app/config.py` + `app/database.py`**

**Bước 1 — Đọc cấu hình từ .env** (`app/config.py`):
```python
# pydantic-settings tự động đọc file .env
class Settings(BaseSettings):
    db_host: str = "127.0.0.1"
    db_port: int = 3306
    db_name: str = "cdss"
    db_user: str = "root"
    db_password: str = ""

    @property
    def database_url(self) -> str:
        # Nếu có DATABASE_URL đầy đủ trong .env → dùng luôn
        if self.database_url_env:
            return _to_pymysql(self.database_url_env)
        # Không thì ghép từ DB_* vars, encode password ký tự đặc biệt
        pwd = quote_plus(self.db_password)
        return (
            f"mysql+pymysql://{self.db_user}:{pwd}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
            f"?charset={self.db_charset}"
        )
```

**Bước 2 — Khởi tạo connection pool** (`app/database.py`):
```python
engine = create_engine(
    settings.database_url,   # mysql+pymysql://root:***@127.0.0.1:3306/cdss
    pool_pre_ping=True,      # ping trước khi dùng connection
    pool_recycle=3600,       # recycle connection sau 1 giờ
    pool_size=10,            # tối đa 10 connection đồng thời
    max_overflow=20,         # có thể mở thêm 20 connection tạm thời lúc tải cao
)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
```

**Bước 3 — Dependency injection vào mỗi request**:
```python
# get_db() được FastAPI tự động inject vào mọi route cần DB
def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()   # tạo Session mới cho mỗi HTTP request
    try:
        yield db          # route handler dùng db này
    finally:
        db.close()        # đóng sau khi response xong

# Cách dùng trong router:
@router.get("/api/v1/drugs")
def list_drugs(db: Session = Depends(get_db)):
    #  ^^^^^^^^^^^^^^^^^^^^ FastAPI tự gọi get_db(), inject db vào đây
    drugs = db.query(Drug).all()
```

---

### 6.4 Backend truy vấn Database — Ví dụ code thực tế

**Ví dụ 1 — Tìm kiếm thuốc theo tên** (`app/routers/api_drugs.py`):
```python
# Câu query tương đương SQL:
# SELECT * FROM drugs
# WHERE MATCH(name) AGAINST('+aspirin*' IN BOOLEAN MODE)
#    OR cas_number LIKE 'aspirin%'
# ORDER BY name
# LIMIT 24 OFFSET 0

qs = db.query(Drug)
ft_q = "+aspirin*"
qs = qs.filter(
    or_(
        text("MATCH(name) AGAINST(:ft_q IN BOOLEAN MODE)"),
        Drug.cas_number.like(f"{query}%"),
    )
).params(ft_q=ft_q)

total = qs.count()
drugs = qs.order_by(Drug.name).offset(0).limit(24).all()
```

**Ví dụ 2 — Tìm tương tác 2 chiều** (`app/core/interaction_engine.py`):
```python
# Câu query tương đương SQL:
# SELECT * FROM drug_interactions
# WHERE drug_id IN ('DB00945', 'DB00682')
#    OR interacting_drug_id IN ('DB00945', 'DB00682')
# -- Sau đó filter Python: chỉ giữ cặp có CẢ 2 thuốc trong input

rows = (
    db.query(DrugInteraction)
    .filter(
        or_(
            DrugInteraction.drug_id.in_(id_set),
            DrugInteraction.interacting_drug_id.in_(id_set),
        )
    )
    .all()
)
# Lọc: giữ chỉ các cặp mà CÙNG LÚC cả drug_id và interacting_drug_id đều trong input
valid = [r for r in rows if r.drug_id in id_set and r.interacting_drug_id in id_set]
```

**Ví dụ 3 — Đếm protein theo loại cho từng thuốc** (`app/routers/api_drugs.py`):
```python
# Câu query tương đương SQL:
# SELECT drug_id, interaction_type, COUNT(id) as cnt
# FROM drug_protein_interactions
# WHERE drug_id IN ('DB00945', 'DB00682', ...)
# GROUP BY drug_id, interaction_type

count_rows = (
    db.query(
        DrugProteinInteraction.drug_id,
        DrugProteinInteraction.interaction_type,
        sqlfunc.count(DrugProteinInteraction.id).label("cnt"),
    )
    .filter(DrugProteinInteraction.drug_id.in_(drugbank_ids))
    .group_by(DrugProteinInteraction.drug_id, DrugProteinInteraction.interaction_type)
    .all()
)
```

**Ví dụ 4 — Lấy lịch sử phiên của 1 user** (`app/routers/api_sessions.py`):
```python
# Câu query tương đương SQL:
# SELECT * FROM analysis_sessions
# WHERE user_id = 42
# ORDER BY created_at DESC
# LIMIT 20 OFFSET 0

sessions = (
    db.query(AnalysisSession)
    .filter(AnalysisSession.user_id == current_user.id)
    .order_by(AnalysisSession.created_at.desc())
    .offset(skip).limit(limit)
    .all()
)
```

---

### 6.5 Frontend gọi API Backend như thế nào

**File tập trung: `frontend/src/lib/api.ts`**

Toàn bộ giao tiếp với backend được đóng gói trong `api.ts`. Các component React không fetch trực tiếp — luôn gọi qua hàm trong file này.

**Cơ chế kết nối:**
```typescript
const BASE = '/api/v1';   // URL tương đối — không hard-code host

// Khi chạy LOCAL: Vite proxy (vite.config.ts) chuyển /api/* → http://localhost:8000
// Khi chạy VPS: IIS ARR rewrite rule chuyển /api/* → http://127.0.0.1:8000
// → Frontend code KHÔNG thay đổi giữa dev và production
```

**`vite.config.ts` — cấu hình proxy dev:**
```typescript
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',  // backend local
        changeOrigin: true,
      },
    },
  },
})
```

**Ví dụ 1 — Tìm kiếm thuốc** (`api.ts`):
```typescript
// Frontend gọi:
const result = await apiFetchDrugs({ q: 'aspirin', page: 1, per_page: 24 });

// Bên trong hàm:
async function apiFetchDrugs(params): Promise<Paginated<Drug>> {
  const sp = new URLSearchParams();
  sp.set('q', params.q);       // → /api/v1/drugs?q=aspirin&page=1&per_page=24
  sp.set('page', '1');
  sp.set('per_page', '24');

  const res = await fetch(`${BASE}/drugs?${sp}`);
  // fetch('/api/v1/drugs?q=aspirin&page=1&per_page=24')
  // Vite proxy → http://localhost:8000/api/v1/drugs?q=aspirin...
  // FastAPI router api_drugs.py xử lý → trả về JSON

  const data = await res.json();
  return { ...data, items: data.items.map(normalizeDrug) };
  // normalizeDrug chuyển field names backend → frontend type Drug
}
```

**Ví dụ 2 — Kiểm tra tương tác thuốc** (từ `InteractionsPage.tsx`):
```typescript
// POST request với JSON body
const response = await fetch('/api/v1/analysis/check-interactions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ drug_ids: ['DB00945', 'DB00682', 'DB01174'] }),
});
const result = await response.json();
// result.interactions_found = [{drug_a_id, drug_b_id, severity, description}, ...]
// result.has_major = true/false
// result.risk_score = 7.5
```

**Ví dụ 3 — Lưu phiên (yêu cầu đăng nhập)** (từ `InteractionsPage.tsx`):
```typescript
const { token } = useAuth();   // JWT token từ AuthContext

await fetch('/api/v1/sessions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,  // ← token bắt buộc
  },
  body: JSON.stringify({
    title: 'Phác đồ: Aspirin, Warfarin',
    drugs_snapshot: [{ id: 'DB00945', name: 'Aspirin' }, ...],
    interactions_found: [...],
    risk_score: 7.5,
    risk_level: 'high',
  }),
});
// Backend api_sessions.py nhận token → get_user_from_token() → lưu với user_id
```

---

### 6.6 Luồng hoàn chỉnh: từ click của user đến dữ liệu hiển thị

#### Luồng A — Tìm kiếm thuốc
```
1. User gõ "aspirin" vào thanh tìm kiếm (Header.tsx)
2. Header.tsx gọi apiFetchDrugs({ q: 'aspirin', per_page: 7 }) [api.ts]
3. api.ts fetch('/api/v1/drugs?q=aspirin&per_page=7')
4. Vite proxy (dev) / IIS ARR (prod) chuyển → FastAPI port 8000
5. FastAPI: api_drugs.py → list_drugs() nhận db: Session = Depends(get_db)
6. SQLAlchemy: MATCH(name) AGAINST('+aspirin*' IN BOOLEAN MODE) → MySQL
7. MySQL trả kết quả → SQLAlchemy ORM objects → DrugOut Pydantic schema → JSON
8. api.ts nhận JSON → normalizeDrug() → Drug objects
9. Header.tsx hiển thị dropdown gợi ý
```

#### Luồng B — Kiểm tra tương tác
```
1. User chọn 3 thuốc, nhấn "Check Interactions" (InteractionsPage.tsx)
2. InteractionsPage gọi POST /api/v1/analysis/check-interactions { drug_ids: [...] }
3. FastAPI: api_analysis.py → check_interactions_endpoint()
4. Gọi interaction_engine.check_interactions(db, drug_ids)
5. Engine query: SELECT * FROM drug_interactions WHERE drug_id IN (...) OR interacting_drug_id IN (...)
6. Filter + deduplicate → CheckInteractionsResponse
7. Gọi risk_engine.compute_risk_score() → điểm 0-10
8. Gọi recommendation_engine.generate_recommendations() → gợi ý lâm sàng
9. FastAPI trả JSON → InteractionsPage hiển thị animation + kết quả
10. Nếu đăng nhập: POST /api/v1/sessions với Bearer token → lưu vào analysis_sessions MySQL
```

#### Luồng C — Xem chi tiết thuốc (DrugDetailPage)
```
1. User click vào thuốc từ kết quả tìm kiếm hoặc DrugsPage
2. React Router → /drugs/:id → DrugDetailPage.tsx mount
3. DrugDetailPage gọi song song (Promise.all):
   - GET /api/v1/drugs/{id}           → thông tin đầy đủ thuốc
   - GET /api/v1/drugs/{id}/network   → network map liên kết protein
4. FastAPI api_drugs.py → get_drug_detail():
   - Eager-load relationships: synonyms_rel, products_rel,
     food_interactions_rel, dosages_rel, protein_relations
   - SQLAlchemy SELECT ... JOIN drug_products, drug_synonyms,
     drug_food_interactions, drug_dosages, drug_protein_interactions
5. Pydantic DrugDetailOut serialize → JSON (gồm danh sách sản phẩm thương mại,
   tên đồng nghĩa, tương tác thức ăn, liều dùng, mạng protein)
6. DrugDetailPage hiển thị tabs:
   - Overview: tên, formula, mô tả
   - Products: 462,594 brand names → dùng proteinCache / drugCache nếu đã cache
   - Interactions: network_map.html (D3.js)
   - Food Interactions: drug_food_interactions
   - Dosages: drug_dosages
```

#### Luồng D — Đăng nhập
```
1. User nhập username + password, nhấn Đăng nhập (AuthPage.tsx)
2. POST /api/v1/auth/login { identifier: 'user', password: 'pass' }
3. FastAPI api_auth.py → login_json():
   - SELECT * FROM users WHERE username = 'user' OR email = 'user'
   - bcrypt.checkpw(password, user.hashed_password)
   - Nếu đúng: tạo JWT { sub: user.id, exp: now+7days }
4. Trả về { access_token, user }
5. AuthContext.login(token, user) → localStorage['medidb_token'] = token
6. Mỗi lần mở lại app: GET /api/v1/auth/me với token → xác nhận token còn hiệu lực
```

#### Luồng E — Admin sửa/bổ sung dữ liệu thuốc (inline editing)
```
1. Admin đăng nhập vào /admin/ (sqladmin, session-based auth riêng)
2. Admin chọn một thuốc → DrugAdmin edit form hiển thị
3. Form gồm các section inline:
   - Synonyms       → bảng drug_synonyms  (thêm/xóa/sửa)
   - Products       → bảng drug_products  (thêm/xóa/sửa brand names)
   - Food Interactions → bảng drug_food_interactions
   - Dosages        → bảng drug_dosages
4. Admin nhấn Save:
   - sqladmin xử lý inline: DELETE cũ + INSERT mới cho mỗi related table
   - Tất cả FK đều có ON DELETE CASCADE → orphan records tự xóa
5. Thay đổi có hiệu lực ngay — không cần restart backend
6. DrugFoodInteractionAdmin và DrugDosageAdmin cũng cho phép edit trực tiếp
   từ menu sidebar admin (không cần qua Drug parent form)
```

#### Luồng F — Trang chủ load số liệu thống kê
```
1. HomePage.tsx mount → gọi apiFetchSiteStats() [api.ts]
2. api.ts gửi 2 request song song (Promise.all):
   - GET /api/v1/drugs?per_page=1  → chỉ lấy field "total" (tổng số thuốc)
   - GET /api/v1/substances?per_page=1 → chỉ lấy field "total" (tổng protein)
3. FastAPI: COUNT(*) trên bảng drugs và proteins → trả số thực tế từ DB
4. HomePage hiển thị "17,430 thuốc" / "5,206 protein" — luôn cập nhật theo DB
```

---

### 6.7 Sơ đồ kiến trúc tổng thể

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          BROWSER (User / Admin)                         │
│                                                                         │
│   React + TypeScript + Tailwind CSS                                     │
│   ┌─────────────┐  ┌──────────────────┐  ┌──────────────────────────┐ │
│   │  AuthContext │  │  lib/api.ts      │  │  public/data/*.json      │ │
│   │  (JWT state) │  │  (fetch wrapper) │  │  (drugs, proteins tĩnh)  │ │
│   └──────┬──────┘  └────────┬─────────┘  └──────────────────────────┘ │
│          │                  │                                           │
└──────────┼──────────────────┼───────────────────────────────────────────┘
           │ Bearer Token     │ HTTP/HTTPS
           │                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    IIS / Vite Dev Server                                 │
│                                                                          │
│   /              → serve index.html (React SPA)                         │
│   /admin/*       → sqladmin UI (inline editing 16 bảng)                │
│   /api/*         → ARR Proxy → http://127.0.0.1:8000  (FastAPI)        │
│   /data/*.json   → serve static JSON files                              │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │ HTTP (internal only)
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    FastAPI (Uvicorn, port 8000)                         │
│                                                                          │
│   app/main.py → startup: create_all() + _repair_schema_if_needed()     │
│              → routers: api_drugs / api_auth / api_analysis / ...      │
│              → /admin/: sqladmin (11 ModelViews, inline editing)        │
│                                                                          │
│   Dependency injection:  get_db() → SQLAlchemy Session                  │
│   3 Engines: interaction_engine / risk_engine / recommendation_engine   │
│   In-memory cache (FastAPICache + simple_cache.py, TTL 300s)            │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │ SQLAlchemy (mysql+pymysql://)
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    MySQL 8 — database: cdss  (16 bảng)                 │
│                                                                          │
│   drugs (17,430)           drug_interactions (2,855,848)                │
│   proteins (5,206)         drug_protein_interactions (33,227)           │
│   drug_products (462,594)  drug_synonyms (~76,000)                     │
│   drug_food_interactions   drug_dosages                                 │
│   drug_external_identifiers  drug_calculated_properties                 │
│   drug_group_map  drug_category_map  groups  categories                 │
│   users  analysis_sessions                                              │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Sơ đồ ERD — 16-Table Schema

Paste đoạn code dưới đây vào [dbdiagram.io](https://dbdiagram.io) để hiển thị sơ đồ quan hệ đầy đủ:

```
// CDSS - 14-Table Normalized Schema
// Paste this into https://dbdiagram.io

Table drugs {
  drugbank_id          varchar(20)   [primary key]
  name                 varchar(500)  [not null]
  type                 varchar(30)
  cas_number           varchar(50)
  unii                 varchar(50)
  atc_codes            varchar(500)
  state                varchar(20)
  inchikey             varchar(200)
  inchi                text
  smiles               text
  molecular_formula    varchar(200)
  average_mass         decimal(14,6)
  monoisotopic_mass    decimal(14,6)
  description          longtext
  indication           longtext
  pharmacodynamics     longtext
  mechanism_of_action  longtext
  toxicity             longtext
  metabolism           longtext
  absorption           longtext
  half_life            text
  protein_binding      text
  route_of_elimination text
  created_at           timestamp
  updated_at           timestamp
}

Table groups {
  id    int          [primary key, increment]
  name  varchar(100) [not null, unique]
}

Table categories {
  id        int          [primary key, increment]
  category  varchar(500) [not null, unique]
  mesh_id   varchar(20)
}

Table proteins {
  id                int          [primary key, increment]
  uniprot_id        varchar(50)  [unique]
  entrez_gene_id    varchar(30)
  name              varchar(500) [not null]
  gene_name         varchar(100)
  protein_type      varchar(30)
  organism          varchar(200)
  general_function  text
  specific_function longtext
  created_at        timestamp
  updated_at        timestamp
}

Table drug_synonyms {
  id        int          [primary key, increment]
  drug_id   varchar(20)  [not null, ref: > drugs.drugbank_id]
  synonym   varchar(500) [not null]
  language  varchar(10)
  coder     varchar(50)
}

Table drug_products {
  id           int          [primary key, increment]
  drug_id      varchar(20)  [not null, ref: > drugs.drugbank_id]
  name         varchar(500) [not null]
  labeller     varchar(300)
  ndc_id       varchar(50)
  dosage_form  varchar(200)
  strength     varchar(200)
  route        varchar(200)
  country      varchar(100)
  source       varchar(50)
}

Table drug_external_identifiers {
  id         int          [primary key, increment]
  drug_id    varchar(20)  [not null, ref: > drugs.drugbank_id]
  resource   varchar(100) [not null]
  identifier varchar(200) [not null]

  indexes {
    (drug_id, resource) [unique]
  }
}

Table drug_calculated_properties {
  id      int          [primary key, increment]
  drug_id varchar(20)  [not null, ref: > drugs.drugbank_id]
  kind    varchar(100) [not null]
  value   text
  source  varchar(50)

  indexes {
    (drug_id, kind, source) [unique]
  }
}

Table drug_group_map {
  drug_id  varchar(20) [not null, ref: > drugs.drugbank_id]
  group_id int         [not null, ref: > groups.id]

  indexes {
    (drug_id, group_id) [pk]
  }
}

Table drug_category_map {
  drug_id     varchar(20) [not null, ref: > drugs.drugbank_id]
  category_id int         [not null, ref: > categories.id]

  indexes {
    (drug_id, category_id) [pk]
  }
}

Table drug_interactions {
  id                    int          [primary key, increment]
  drug_id               varchar(20)  [not null, ref: > drugs.drugbank_id]
  drug_name             varchar(500)
  interacting_drug_id   varchar(20)  [not null]
  interacting_drug_name varchar(500)
  severity              varchar(20)
  description           longtext
  created_at            timestamp
  updated_at            timestamp

  indexes {
    (drug_id, interacting_drug_id) [unique]
  }
}

Table drug_protein_interactions {
  id               int         [primary key, increment]
  drug_id          varchar(20) [not null, ref: > drugs.drugbank_id]
  protein_id       int         [not null, ref: > proteins.id]
  uniprot_id       varchar(50)
  interaction_type varchar(30)
  known_action     varchar(10)
  actions          varchar(500)
  pubmed_ids       varchar(500)
  created_at       timestamp

  indexes {
    (drug_id, protein_id, interaction_type) [unique]
  }
}

Table users {
  id              int          [primary key, increment]
  username        varchar(100) [not null, unique]
  email           varchar(255) [not null, unique]
  full_name       varchar(200) [not null]
  hashed_password varchar(255) [not null]
  is_active       boolean      [default: true]
  avatar_color    varchar(20)
  created_at      timestamp
  updated_at      timestamp
}

Table analysis_sessions {
  id                 int          [primary key, increment]
  user_id            int          [ref: > users.id]
  title              varchar(500) [not null]
  tags               varchar(500)
  drugs_snapshot     varchar(500)
  interactions_found varchar(500)
  total_drugs        int          [default: 0]
  total_interactions int          [default: 0]
  major_count        int          [default: 0]
  moderate_count     int          [default: 0]
  minor_count        int          [default: 0]
  risk_score         float
  risk_level         varchar(20)
  notes              longtext
  created_at         timestamp
  updated_at         timestamp
}

Table drug_food_interactions {
  id          int         [primary key, increment]
  drug_id     varchar(20) [not null, ref: > drugs.drugbank_id]
  interaction text        [not null]
}

Table drug_dosages {
  id       int         [primary key, increment]
  drug_id  varchar(20) [not null, ref: > drugs.drugbank_id]
  form     varchar(200)
  route    varchar(200)
  strength varchar(200)
}
```

---

## 8. Tham chiếu Truy vấn MySQL

> Tất cả query dưới đây chạy trên database `cdss`.
> Prefix mỗi block bằng `USE cdss;` nếu chưa chọn DB.

---

### 8.1 Bảng `drugs` — Thông tin thuốc cơ bản

```sql
USE cdss;

-- 1. Xem 5 thuốc đầu tiên (id, tên, loại, trạng thái, công thức hoá học)
SELECT drugbank_id, name, type, state, molecular_formula, average_mass
FROM drugs
LIMIT 5;

-- 2. Tìm thuốc theo tên (tìm kiếm gần đúng)
SELECT drugbank_id, name, type, state
FROM drugs
WHERE name LIKE '%aspirin%';

-- 3. Xem thông tin đầy đủ một thuốc cụ thể (Dexamethasone)
SELECT drugbank_id, name, type, state, molecular_formula,
       average_mass, monoisotopic_mass, smiles, inchikey, cas_number, unii,
       description, indication, mechanism_of_action, pharmacodynamics,
       toxicity, absorption, metabolism, half_life, protein_binding
FROM drugs
WHERE drugbank_id = 'DB01234';

-- 4. Thống kê số thuốc theo loại (small molecule vs biotech)
SELECT type, COUNT(*) AS so_luong
FROM drugs
GROUP BY type
ORDER BY so_luong DESC;

-- 5. Thống kê thuốc theo trạng thái (approved, experimental, ...)
SELECT state, COUNT(*) AS so_luong
FROM drugs
GROUP BY state
ORDER BY so_luong DESC;

-- 6. Thuốc có khối lượng phân tử lớn nhất (top 10)
SELECT drugbank_id, name, molecular_formula, average_mass
FROM drugs
WHERE average_mass IS NOT NULL
ORDER BY average_mass DESC
LIMIT 10;

-- 7. Tìm thuốc theo mã ATC
SELECT drugbank_id, name, atc_codes, type
FROM drugs
WHERE atc_codes LIKE '%H02AB%';

-- 8. Thuốc có SMILES (có cấu trúc hoá học)
SELECT COUNT(*) AS co_smiles,
       (SELECT COUNT(*) FROM drugs) AS tong_so,
       ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM drugs), 1) AS phan_tram
FROM drugs
WHERE smiles IS NOT NULL AND smiles != '';
```

---

### 8.2 Bảng `drug_synonyms` — Tên đồng nghĩa / biệt dược

```sql
USE cdss;

-- 9. Xem tất cả tên gọi khác của một thuốc
SELECT s.synonym, s.language, s.coder
FROM drug_synonyms s
WHERE s.drug_id = 'DB01234'
ORDER BY s.language;

-- 10. Tìm thuốc qua tên biệt dược
SELECT d.drugbank_id, d.name, s.synonym, s.language
FROM drug_synonyms s
JOIN drugs d ON d.drugbank_id = s.drug_id
WHERE s.synonym LIKE '%Decadron%';

-- 11. Thuốc có nhiều tên đồng nghĩa nhất (top 10)
SELECT d.drugbank_id, d.name, COUNT(s.id) AS so_ten
FROM drugs d
JOIN drug_synonyms s ON s.drug_id = d.drugbank_id
GROUP BY d.drugbank_id, d.name
ORDER BY so_ten DESC
LIMIT 10;
```

---

### 8.3 Bảng `drug_products` — Sản phẩm thương mại

```sql
USE cdss;

-- 12. Xem sản phẩm thương mại của một thuốc
SELECT p.name, p.labeller, p.dosage_form, p.strength, p.route, p.country
FROM drug_products p
WHERE p.drug_id = 'DB01234'
ORDER BY p.country, p.name
LIMIT 20;

-- 13. Tìm sản phẩm theo tên thương mại
SELECT p.name AS ten_thuong_mai, d.drugbank_id, d.name AS ten_goc,
       p.dosage_form, p.strength, p.route, p.country
FROM drug_products p
JOIN drugs d ON d.drugbank_id = p.drug_id
WHERE p.name LIKE '%Tylenol%';

-- 14. Thống kê sản phẩm theo quốc gia
SELECT country, COUNT(*) AS so_san_pham
FROM drug_products
WHERE country IS NOT NULL AND country != ''
GROUP BY country
ORDER BY so_san_pham DESC
LIMIT 15;

-- 15. Thuốc có nhiều sản phẩm thương mại nhất (top 10)
SELECT d.drugbank_id, d.name, COUNT(p.id) AS so_san_pham
FROM drugs d
JOIN drug_products p ON p.drug_id = d.drugbank_id
GROUP BY d.drugbank_id, d.name
ORDER BY so_san_pham DESC
LIMIT 10;

-- 16. Đường dùng thuốc phổ biến nhất
SELECT route, COUNT(*) AS so_luong
FROM drug_products
WHERE route IS NOT NULL AND route != ''
GROUP BY route
ORDER BY so_luong DESC
LIMIT 10;
```

---

### 8.4 Bảng `groups` + `drug_group_map` — Nhóm phê duyệt

```sql
USE cdss;

-- 17. Xem tất cả nhóm phê duyệt
SELECT id, name FROM groups ORDER BY name;

-- 18. Thuốc thuộc nhóm "approved"
SELECT d.drugbank_id, d.name, d.type, d.state
FROM drugs d
JOIN drug_group_map m ON m.drug_id = d.drugbank_id
JOIN groups g ON g.id = m.group_id
WHERE g.name = 'approved'
LIMIT 20;

-- 19. Thuốc vừa approved vừa experimental
SELECT d.drugbank_id, d.name
FROM drugs d
WHERE d.drugbank_id IN (
    SELECT m.drug_id FROM drug_group_map m JOIN groups g ON g.id = m.group_id WHERE g.name = 'approved'
)
AND d.drugbank_id IN (
    SELECT m.drug_id FROM drug_group_map m JOIN groups g ON g.id = m.group_id WHERE g.name = 'experimental'
);

-- 20. Thống kê số thuốc theo nhóm
SELECT g.name AS nhom, COUNT(m.drug_id) AS so_thuoc
FROM groups g
JOIN drug_group_map m ON m.group_id = g.id
GROUP BY g.name
ORDER BY so_thuoc DESC;
```

---

### 8.5 Bảng `categories` + `drug_category_map` — Nhóm bệnh / chỉ định

```sql
USE cdss;

-- 21. Xem danh sách category (giới hạn 20)
SELECT id, category, mesh_id FROM categories LIMIT 20;

-- 22. Tìm thuốc theo nhóm bệnh
SELECT d.drugbank_id, d.name, d.type
FROM drugs d
JOIN drug_category_map m ON m.drug_id = d.drugbank_id
JOIN categories c ON c.id = m.category_id
WHERE c.category LIKE '%Anti-Inflammatory%'
LIMIT 20;

-- 23. Thuốc điều trị tim mạch
SELECT d.drugbank_id, d.name, c.category
FROM drugs d
JOIN drug_category_map m ON m.drug_id = d.drugbank_id
JOIN categories c ON c.id = m.category_id
WHERE c.category LIKE '%Cardiovascular%'
ORDER BY d.name
LIMIT 20;

-- 24. Xem tất cả category của một thuốc
SELECT c.category, c.mesh_id
FROM categories c
JOIN drug_category_map m ON m.category_id = c.id
WHERE m.drug_id = 'DB01234'
ORDER BY c.category;

-- 25. Category có nhiều thuốc nhất (top 15)
SELECT c.category, COUNT(m.drug_id) AS so_thuoc
FROM categories c
JOIN drug_category_map m ON m.category_id = c.id
GROUP BY c.id, c.category
ORDER BY so_thuoc DESC
LIMIT 15;
```

---

### 8.6 Bảng `proteins` — Protein / Mục tiêu sinh học

```sql
USE cdss;

-- 26. Xem 10 protein đầu tiên
SELECT id, uniprot_id, name, gene_name, protein_type, organism
FROM proteins
LIMIT 10;

-- 27. Tìm protein theo tên gene
SELECT id, uniprot_id, name, gene_name, protein_type, organism
FROM proteins
WHERE gene_name LIKE '%CYP%'
ORDER BY gene_name;

-- 28. Protein theo loại (target, enzyme, transporter, carrier)
SELECT protein_type, COUNT(*) AS so_luong
FROM proteins
WHERE protein_type IS NOT NULL
GROUP BY protein_type
ORDER BY so_luong DESC;

-- 29. Protein của người (Human only)
SELECT id, uniprot_id, name, gene_name, protein_type
FROM proteins
WHERE organism LIKE '%Human%' OR organism LIKE '%Homo sapiens%'
LIMIT 20;

-- 30. Xem chức năng đầy đủ của một protein
SELECT uniprot_id, name, gene_name, protein_type, organism,
       general_function, specific_function
FROM proteins
WHERE uniprot_id = 'GCR_HUMAN';

-- 31. Tổng số protein theo organism
SELECT organism, COUNT(*) AS so_luong
FROM proteins
WHERE organism IS NOT NULL
GROUP BY organism
ORDER BY so_luong DESC
LIMIT 10;
```

---

### 8.7 Bảng `drug_protein_interactions` — Tương tác Thuốc–Protein

```sql
USE cdss;

-- 32. Protein mục tiêu của một thuốc (Dexamethasone)
SELECT p.name, p.gene_name, p.uniprot_id, dpi.interaction_type,
       dpi.known_action, dpi.actions
FROM drug_protein_interactions dpi
JOIN proteins p ON p.id = dpi.protein_id
WHERE dpi.drug_id = 'DB01234'
ORDER BY dpi.interaction_type;

-- 33. Thuốc nào tương tác với Glucocorticoid receptor (NR3C1)
SELECT d.drugbank_id, d.name, dpi.interaction_type, dpi.known_action, dpi.actions
FROM drug_protein_interactions dpi
JOIN drugs d ON d.drugbank_id = dpi.drug_id
JOIN proteins p ON p.id = dpi.protein_id
WHERE p.gene_name = 'NR3C1'
ORDER BY d.name;

-- 34. Thuốc ức chế CYP3A4 (enzyme chuyển hoá phổ biến nhất)
SELECT d.drugbank_id, d.name, dpi.actions
FROM drug_protein_interactions dpi
JOIN drugs d ON d.drugbank_id = dpi.drug_id
JOIN proteins p ON p.id = dpi.protein_id
WHERE p.gene_name = 'CYP3A4'
  AND dpi.actions LIKE '%inhibitor%'
ORDER BY d.name
LIMIT 20;

-- 35. Protein bị nhiều thuốc tương tác nhất (top 15)
SELECT p.name, p.gene_name, p.protein_type, COUNT(dpi.drug_id) AS so_thuoc
FROM proteins p
JOIN drug_protein_interactions dpi ON dpi.protein_id = p.id
GROUP BY p.id, p.name, p.gene_name, p.protein_type
ORDER BY so_thuoc DESC
LIMIT 15;

-- 36. Thuốc có nhiều protein mục tiêu nhất (top 10)
SELECT d.drugbank_id, d.name,
       COUNT(dpi.protein_id)                            AS tong_protein,
       SUM(dpi.interaction_type = 'target')             AS targets,
       SUM(dpi.interaction_type = 'enzyme')             AS enzymes,
       SUM(dpi.interaction_type = 'transporter')        AS transporters,
       SUM(dpi.interaction_type = 'carrier')            AS carriers
FROM drugs d
JOIN drug_protein_interactions dpi ON dpi.drug_id = d.drugbank_id
GROUP BY d.drugbank_id, d.name
ORDER BY tong_protein DESC
LIMIT 10;

-- 37. Thống kê loại tương tác thuốc–protein
SELECT interaction_type, known_action, COUNT(*) AS so_luong
FROM drug_protein_interactions
GROUP BY interaction_type, known_action
ORDER BY interaction_type, so_luong DESC;
```

---

### 8.8 Bảng `drug_interactions` — Tương tác Thuốc–Thuốc

```sql
USE cdss;

-- 38. Xem tất cả tương tác của một thuốc (Simvastatin)
SELECT di.interacting_drug_id, di.interacting_drug_name,
       di.severity, LEFT(di.description, 200) AS mo_ta
FROM drug_interactions di
WHERE di.drug_id = 'DB00641'
ORDER BY di.severity, di.interacting_drug_name
LIMIT 20;

-- 39. Top 20 thuốc có nhiều tương tác major nhất
SELECT d.drugbank_id, d.name, COUNT(*) AS so_tuong_tac_major
FROM drug_interactions di
JOIN drugs d ON d.drugbank_id = di.drug_id
WHERE di.severity = 'major'
GROUP BY d.drugbank_id, d.name
ORDER BY so_tuong_tac_major DESC
LIMIT 20;

-- 40. Kiểm tra tương tác giữa 2 thuốc cụ thể
SELECT di.drug_id, di.interacting_drug_id, di.severity, di.description
FROM drug_interactions di
WHERE (di.drug_id = 'DB01234' AND di.interacting_drug_id = 'DB00641')
   OR (di.drug_id = 'DB00641' AND di.interacting_drug_id = 'DB01234');

-- 41. Thống kê tương tác theo mức độ nghiêm trọng
SELECT severity, COUNT(*) AS so_cap_tuong_tac
FROM drug_interactions
GROUP BY severity
ORDER BY FIELD(severity, 'major', 'moderate', 'minor');

-- 42. Thuốc có nhiều tương tác nhất (tất cả mức độ)
SELECT d.drugbank_id, d.name,
       COUNT(*)                          AS tong,
       SUM(di.severity = 'major')        AS major,
       SUM(di.severity = 'moderate')     AS moderate,
       SUM(di.severity = 'minor')        AS minor
FROM drug_interactions di
JOIN drugs d ON d.drugbank_id = di.drug_id
GROUP BY d.drugbank_id, d.name
ORDER BY tong DESC
LIMIT 15;
```

---

### 8.9 Bảng `drug_calculated_properties` — Tính chất hoá học tính toán

```sql
USE cdss;

-- 43. Xem tất cả tính chất hoá học của một thuốc
SELECT kind, value, source
FROM drug_calculated_properties
WHERE drug_id = 'DB01234'
ORDER BY kind;

-- 44. So sánh LogP (lipophilicity) của nhiều thuốc
SELECT d.drugbank_id, d.name, cp.value AS logP
FROM drug_calculated_properties cp
JOIN drugs d ON d.drugbank_id = cp.drug_id
WHERE cp.kind = 'logP'
ORDER BY CAST(cp.value AS DECIMAL(10,4)) DESC
LIMIT 20;

-- 45. Tìm thuốc theo trọng lượng phân tử (200–400 Da)
SELECT d.drugbank_id, d.name, cp.value AS mol_weight
FROM drug_calculated_properties cp
JOIN drugs d ON d.drugbank_id = cp.drug_id
WHERE cp.kind = 'Molecular Weight'
  AND CAST(cp.value AS DECIMAL(10,2)) BETWEEN 200 AND 400
ORDER BY CAST(cp.value AS DECIMAL(10,2))
LIMIT 20;

-- 46. Tất cả loại tính chất hoá học có trong DB
SELECT kind, COUNT(*) AS so_thuoc, source
FROM drug_calculated_properties
GROUP BY kind, source
ORDER BY so_thuoc DESC;
```

---

### 8.10 Bảng `drug_external_identifiers` — Mã định danh ngoài (PubChem, ChEMBL, ...)

```sql
USE cdss;

-- 47. Tìm thuốc theo mã PubChem CID
SELECT d.drugbank_id, d.name, ei.identifier AS pubchem_cid
FROM drug_external_identifiers ei
JOIN drugs d ON d.drugbank_id = ei.drug_id
WHERE ei.resource = 'PubChem Compound'
  AND ei.identifier = '5743';

-- 48. Xem tất cả mã định danh ngoài của một thuốc
SELECT resource, identifier
FROM drug_external_identifiers
WHERE drug_id = 'DB01234'
ORDER BY resource;

-- 49. Các nguồn định danh có trong hệ thống
SELECT resource, COUNT(*) AS so_thuoc
FROM drug_external_identifiers
GROUP BY resource
ORDER BY so_thuoc DESC;

-- 50. Tìm thuốc theo mã ChEMBL
SELECT d.drugbank_id, d.name, ei.identifier AS chembl_id
FROM drug_external_identifiers ei
JOIN drugs d ON d.drugbank_id = ei.drug_id
WHERE ei.resource = 'ChEMBL'
LIMIT 10;
```

---

### 8.11 Bảng `users` + `analysis_sessions` — Người dùng & Lịch sử phân tích

```sql
USE cdss;

-- 51. Xem danh sách người dùng (không hiện password)
SELECT id, username, email, full_name, is_active, created_at
FROM users
ORDER BY created_at DESC;

-- 52. Xem lịch sử phân tích của một user
SELECT id, title, tags, total_drugs, total_interactions,
       major_count, moderate_count, minor_count,
       risk_score, risk_level, created_at
FROM analysis_sessions
WHERE user_id = 1
ORDER BY created_at DESC;

-- 53. Các phân tích có rủi ro cao nhất
SELECT s.title, s.risk_score, s.risk_level,
       s.total_drugs, s.major_count, u.username
FROM analysis_sessions s
JOIN users u ON u.id = s.user_id
WHERE s.risk_level = 'high'
ORDER BY s.risk_score DESC
LIMIT 10;

-- 54. Thống kê tổng số phân tích theo user
SELECT u.username, COUNT(s.id) AS so_lan_phan_tich,
       ROUND(AVG(s.risk_score), 2) AS diem_rui_ro_tb
FROM users u
JOIN analysis_sessions s ON s.user_id = u.id
GROUP BY u.id, u.username
ORDER BY so_lan_phan_tich DESC;
```

---

### 8.12 Query Tổng Hợp — Multi-table JOIN

```sql
USE cdss;

-- 55. Profile đầy đủ một thuốc: tên, nhóm, category, protein, sản phẩm
SELECT
    d.drugbank_id, d.name, d.type, d.state,
    GROUP_CONCAT(DISTINCT g.name ORDER BY g.name SEPARATOR ', ')  AS nhom_phe_duyet,
    COUNT(DISTINCT dpi.protein_id)                                 AS so_protein,
    COUNT(DISTINCT di.interacting_drug_id)                         AS so_tuong_tac_thuoc,
    COUNT(DISTINCT p.id)                                           AS so_san_pham_thuong_mai
FROM drugs d
LEFT JOIN drug_group_map             m   ON m.drug_id  = d.drugbank_id
LEFT JOIN groups                     g   ON g.id       = m.group_id
LEFT JOIN drug_protein_interactions  dpi ON dpi.drug_id = d.drugbank_id
LEFT JOIN drug_interactions          di  ON di.drug_id  = d.drugbank_id
LEFT JOIN drug_products              p   ON p.drug_id   = d.drugbank_id
WHERE d.drugbank_id = 'DB01234'
GROUP BY d.drugbank_id, d.name, d.type, d.state;

-- 56. Thuốc dùng chung CYP3A4 (nguy cơ tương tác chuyển hoá)
SELECT d.drugbank_id, d.name, dpi.interaction_type, dpi.actions
FROM drug_protein_interactions dpi
JOIN drugs d ON d.drugbank_id = dpi.drug_id
JOIN proteins p ON p.id = dpi.protein_id
WHERE p.gene_name = 'CYP3A4'
ORDER BY dpi.interaction_type, d.name
LIMIT 30;

-- 57. Top thuốc nguy hiểm nhất: nhiều tương tác major + nhiều protein mục tiêu
SELECT d.drugbank_id, d.name,
       COUNT(DISTINCT di.interacting_drug_id)  AS major_interactions,
       COUNT(DISTINCT dpi.protein_id)          AS protein_targets
FROM drugs d
JOIN drug_interactions         di  ON di.drug_id  = d.drugbank_id AND di.severity = 'major'
JOIN drug_protein_interactions dpi ON dpi.drug_id = d.drugbank_id
GROUP BY d.drugbank_id, d.name
ORDER BY major_interactions DESC, protein_targets DESC
LIMIT 15;

-- 58. Tổng quan toàn bộ database
SELECT
    (SELECT COUNT(*) FROM drugs)                      AS tong_thuoc,
    (SELECT COUNT(*) FROM proteins)                   AS tong_protein,
    (SELECT COUNT(*) FROM drug_interactions)          AS tong_tuong_tac_thuoc_thuoc,
    (SELECT COUNT(*) FROM drug_protein_interactions)  AS tong_tuong_tac_thuoc_protein,
    (SELECT COUNT(*) FROM drug_products)              AS tong_san_pham_thuong_mai,
    (SELECT COUNT(*) FROM drug_synonyms)              AS tong_ten_dong_nghia,
    (SELECT COUNT(*) FROM categories)                 AS tong_category,
    (SELECT COUNT(*) FROM groups)                     AS tong_nhom,
    (SELECT COUNT(*) FROM drug_food_interactions)     AS tong_tuong_tac_thuc_an,
    (SELECT COUNT(*) FROM drug_dosages)               AS tong_lieu_dung,
    (SELECT COUNT(*) FROM users)                      AS tong_nguoi_dung,
    (SELECT COUNT(*) FROM analysis_sessions)          AS tong_phien_phan_tich;
```

---

### 8.13 Bảng `drug_food_interactions` + `drug_dosages`

```sql
USE cdss;

-- Xem tất cả tương tác thức ăn của một thuốc
SELECT dfi.interaction
FROM drug_food_interactions dfi
WHERE dfi.drug_id = 'DB00945'  -- Aspirin
ORDER BY dfi.id;

-- Thuốc nào có nhiều tương tác thức ăn nhất
SELECT d.name, COUNT(dfi.id) AS so_tuong_tac_thuc_an
FROM drugs d
JOIN drug_food_interactions dfi ON dfi.drug_id = d.drugbank_id
GROUP BY d.drugbank_id, d.name
ORDER BY so_tuong_tac_thuc_an DESC
LIMIT 20;

-- Xem liều dùng của một thuốc
SELECT form, route, strength
FROM drug_dosages
WHERE drug_id = 'DB00945'
ORDER BY route, form;

-- Thuốc có nhiều dạng liều dùng nhất
SELECT d.name, COUNT(dd.id) AS so_lieu_dung
FROM drugs d
JOIN drug_dosages dd ON dd.drug_id = d.drugbank_id
GROUP BY d.drugbank_id, d.name
ORDER BY so_lieu_dung DESC
LIMIT 20;

-- Thống kê các dạng đường dùng phổ biến
SELECT route, COUNT(*) AS so_luong
FROM drug_dosages
WHERE route IS NOT NULL
GROUP BY route
ORDER BY so_luong DESC;
```

---

*Data source: DrugBank® v5 — licensed for academic use*
*MediDB — Clinical Decision Support System — Sprint 8 — 13/05/2026*
