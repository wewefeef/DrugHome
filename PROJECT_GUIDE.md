# MediDB — Clinical Decision Support System
### Hướng dẫn vận hành toàn bộ dự án

---

## Mục lục
1. [Tổng quan hệ thống](#1-tổng-quan-hệ-thống)
2. [Yêu cầu cài đặt](#2-yêu-cầu-cài-đặt)
3. [Cách chạy hệ thống](#3-cách-chạy-hệ-thống)
4. [Cấu trúc Back-end](#4-cấu-trúc-back-end)
5. [Cấu trúc Front-end](#5-cấu-trúc-front-end)
6. [Database & Dữ liệu](#6-database--dữ-liệu)
7. [API Endpoints](#7-api-endpoints)
8. [Luồng dữ liệu](#8-luồng-dữ-liệu)

---

## 1. Tổng quan hệ thống

```
d:\Du_an\
├── .venv/                          ← Python virtual environment dùng chung
├── Back_end/
│   ├── Clinical Decision Support System - cintana/   ← Toàn bộ FastAPI backend
│   └── Database/                   ← Dữ liệu gốc DrugBank XML + NDJSON
└── Front-end/                      ← React + Vite + TypeScript frontend
```

**Công nghệ:**
| Layer | Stack |
|---|---|
| Frontend | React 19 · Vite · TypeScript · Tailwind CSS v3 · React Router DOM |
| Backend | FastAPI · SQLAlchemy 2.0 · MySQL (PyMySQL) · Alembic · sqladmin |
| Database | MySQL — schema `cdss` — 4 bảng chính |
| Data source | DrugBank v5 — 17,590 thuốc · 24,386 cặp tương tác |

---

## 2. Yêu cầu cài đặt

### Python (Backend)
```powershell
# Kích hoạt virtual environment
d:\Du_an\.venv\Scripts\Activate.ps1

# Cài dependencies (lần đầu)
cd "D:\Du_an\Back_end\Clinical Decision Support System - cintana"
pip install -r requirements.txt
```

### Node.js (Frontend)
```powershell
cd D:\Du_an\Front-end
npm install
```

### MySQL
- Tạo database: `CREATE DATABASE cdss CHARACTER SET utf8mb4;`
- Cấu hình file `.env` (xem mục cấu hình bên dưới)

---

## 3. Cách chạy hệ thống

### Bước 1 — Cấu hình môi trường Backend

Tạo file `.env` trong `Back_end/Clinical Decision Support System - cintana/`:

```env
DEBUG=true
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=cdss
DB_USER=root
DB_PASSWORD=your_password
SECRET_KEY=your-secret-key-here
```

### Bước 2 — Chạy Backend (FastAPI)

```powershell
# Terminal 1
cd "D:\Du_an\Back_end\Clinical Decision Support System - cintana"
d:\Du_an\.venv\Scripts\uvicorn.exe app.main:app --host 0.0.0.0 --port 8000 --reload
```

✅ Backend chạy tại: `http://localhost:8000`
📖 Swagger API docs: `http://localhost:8000/api/docs`
📖 ReDoc: `http://localhost:8000/api/redoc`
🔧 Admin UI: `http://localhost:8000/admin/`

### Bước 3 — Chạy Frontend (React + Vite)

```powershell
# Terminal 2
cd D:\Du_an\Front-end
npm run dev
```

✅ Frontend chạy tại: `http://localhost:5173`

> **Lưu ý:** Vite tự proxy `/api/*` → `localhost:8000` nên không bị lỗi CORS.
> Cần chạy **cả 2 terminal** cùng lúc để hệ thống hoạt động đầy đủ.

### Các lệnh khác

```powershell
# Build production frontend
npm run build        # tạo thư mục dist/

# Preview production build
npm run preview

# Kiểm tra TypeScript errors
npm run lint
```

---

## 4. Cấu trúc Back-end

```
Back_end/
├── Clinical Decision Support System - cintana/
│   ├── app/                        ← FastAPI application source code
│   │   ├── main.py                 ← Entry point — khởi tạo FastAPI app, CORS, routes
│   │   ├── config.py               ← Cấu hình từ .env (DB host, port, secret key...)
│   │   ├── database.py             ← SQLAlchemy engine + session factory
│   │   ├── models.py               ← ORM models — 4 bảng MySQL
│   │   ├── schemas.py              ← Pydantic schemas — request/response validation
│   │   ├── admin.py                ← sqladmin UI — quản lý Drug qua giao diện web
│   │   │
│   │   ├── core/                   ← 3 engines phân tích lâm sàng
│   │   │   ├── interaction_engine.py    ← Tìm tương tác thuốc-thuốc (bidirectional)
│   │   │   ├── risk_engine.py           ← Tính điểm rủi ro 0–10 (CYP + targets)
│   │   │   └── recommendation_engine.py ← Gợi ý lâm sàng theo context bệnh nhân
│   │   │
│   │   └── routers/                ← API route handlers
│   │       ├── api_drugs.py        ← REST CRUD: GET/POST/PATCH /api/v1/drugs/
│   │       ├── api_substances.py   ← REST CRUD: GET/POST/PATCH /api/v1/substances/
│   │       ├── api_interactions.py ← REST CRUD: GET/POST/PATCH /api/v1/interactions/
│   │       ├── api_analysis.py     ← Clinical engines: /api/v1/analysis/*
│   │       └── drugs.py            ← HTML routes → Jinja2 templates (drug monograph UI)
│   │
│   ├── scripts/                    ← Scripts import dữ liệu vào MySQL
│   │   ├── xml_to_json.py          ← Bước 1: Chuyển drugbank_full.xml → 4 file NDJSON
│   │   ├── json_to_mysql.py        ← Bước 2: Import NDJSON → MySQL (drugs + interactions)
│   │   └── load_drugbank.py        ← CLI Typer: chạy toàn bộ pipeline import
│   │
│   ├── utils/                      ← Tiện ích debug database
│   │   ├── _check_db.py            ← Kiểm tra trạng thái DB (version, record counts)
│   │   └── _repair_db.py           ← Sửa dữ liệu lỗi (empty drug_code, duplicates)
│   │
│   ├── alembic/                    ← Database migrations
│   │   ├── env.py                  ← Kết nối Alembic với SQLAlchemy models
│   │   ├── script.py.mako          ← Template sinh migration file
│   │   └── versions/               ← Các file migration (hiện tại trống — dùng create_all)
│   │
│   ├── drugs/templates/drugs/      ← Jinja2 HTML templates (server-side rendering)
│   │   ├── index.html              ← Trang danh sách thuốc (HTML)
│   │   ├── monograph_detail.html   ← Trang chi tiết thuốc (HTML)
│   │   ├── network_map.html        ← Mạng lưới tương tác (HTML)
│   │   ├── about.html              ← Trang about (HTML)
│   │   └── _header.html            ← Header partial template
│   │
│   ├── static/img/                 ← Ảnh tĩnh cho HTML templates
│   ├── docs/                       ← Tài liệu nội bộ
│   │   ├── SYSTEM_ARCHITECTURE_PLAN.md  ← Thiết kế hệ thống
│   │   ├── HUONG_DAN_MYSQL.md           ← Hướng dẫn setup MySQL
│   │   └── DRUGBANK_UPDATE_GUIDE.txt    ← Hướng dẫn cập nhật DrugBank
│   ├── alembic.ini                 ← Cấu hình Alembic migration tool
│   └── requirements.txt            ← Python dependencies
│
└── Database/                       ← Dữ liệu gốc DrugBank
    ├── drugbank_full.xml           ← Toàn bộ database DrugBank v5 (~1.7GB XML)
    ├── drugbank.xsd                ← XML Schema — cấu trúc file XML
    └── data/                       ← NDJSON đã parse (sinh ra bởi xml_to_json.py)
        ├── drugs.ndjson            ← 17,430 thuốc (1 JSON object/dòng)
        ├── drug_interactions.ndjson ← 24,386+ cặp tương tác
        ├── proteins.ndjson         ← 5,206 protein/target
        └── drug_protein_interactions.ndjson ← Liên kết thuốc ↔ protein
```

### Chi tiết các file quan trọng

#### `app/main.py` — Entry Point
```python
# Khởi tạo FastAPI app, đăng ký:
# - CORS middleware (allow all origins khi debug=True)
# - Static files tại /static
# - Admin UI (sqladmin) tại /admin
# - Tất cả routers

# Chạy bằng:
uvicorn app.main:app --reload --port 8000
```

#### `app/models.py` — Database Models
| Model | Bảng MySQL | Mô tả |
|---|---|---|
| `Drug` | `drugs` | Thuốc — drugbank_id, name, description, targets (JSON)... |
| `Protein` | `proteins` | Protein/Target — uniprot_id, gene_name, organism... |
| `DrugInteraction` | `drug_interactions` | Cặp tương tác — severity, description |
| `DrugProteinInteraction` | `drug_protein_interactions` | Liên kết thuốc ↔ protein |

#### `app/core/interaction_engine.py` — Interaction Engine
```
Input:  List[DrugBank ID]  (ví dụ: ["DB00945", "DB00682"])
Output: CheckInteractionsResponse
  - interactions_found: [{ drug_a, drug_b, severity, description }]
  - total_interactions, has_major, has_moderate

Thuật toán:
  1. Resolve DrugBank ID → drug_code (DR:XXXXX)
  2. Query bảng drug_interactions (bidirectional lookup)
  3. Filter: chỉ giữ các cặp có cả 2 thuốc trong input
  4. Deduplicate A↔B = B↔A
```

#### `app/core/risk_engine.py` — Risk Scoring Engine
```
Input:  List[DrugBank ID]
Output: RiskScoreResult
  - score: 0.0–10.0
  - risk_level: "low" | "moderate" | "high" | "critical"
  - shared_enzymes: [CYP3A4, ...]
  - shared_targets: [protein name, ...]
  - explanation: string

Điểm: major(+3) + moderate(+1.5) + minor(+0.5) + shared_CYP(+0.8) + shared_target(+0.5)
```

#### `scripts/xml_to_json.py` — Parser DrugBank XML
```powershell
# Chạy 1 lần để tạo 4 file NDJSON từ XML gốc
python -m scripts.xml_to_json "D:/Du_an/Database/drugbank_full.xml"
# Output → D:/Du_an/Database/data/*.ndjson
```

#### `scripts/json_to_mysql.py` — Import vào MySQL
```powershell
# Chạy sau xml_to_json.py để load dữ liệu vào MySQL
python -m scripts.json_to_mysql
```

---

## 5. Cấu trúc Front-end

```
Front-end/
├── src/
│   ├── main.tsx                    ← Entry point React — mount App vào #root
│   ├── App.tsx                     ← Router config — định nghĩa tất cả routes
│   ├── index.css                   ← Global CSS — Tailwind directives + custom vars
│   │
│   ├── pages/                      ← Các trang chính (1 file = 1 route)
│   │   ├── HomePage.tsx            ← Trang chủ — hero, stats, featured drugs
│   │   ├── DrugsPage.tsx           ← Danh sách 17,430 thuốc — search, filter, pagination
│   │   ├── DrugDetailPage.tsx      ← Chi tiết 1 thuốc — mạng lưới SVG + bảng hóa học
│   │   ├── InteractionsPage.tsx    ← Drug Interaction Checker — 3D viz + real API
│   │   ├── ProteinsPage.tsx        ← Danh sách 5,206 protein — table, badges, search
│   │   └── AnalysisPage.tsx        ← Trang phân tích lâm sàng (risk score + gợi ý)
│   │
│   ├── components/                 ← Shared UI components
│   │   ├── Header.tsx              ← Navigation bar — logo, nav links, search bar
│   │   └── Footer.tsx              ← Footer — copyright, links
│   │
│   ├── lib/                        ← Data fetching + caching
│   │   ├── drugCache.ts            ← Singleton cache: fetch drugs.json 1 lần, share toàn app
│   │   └── proteinCache.ts         ← Singleton cache: fetch proteins.json 1 lần
│   │
│   ├── types/
│   │   └── drug.ts                 ← TypeScript interface Drug (drugbank_id, name, targets...)
│   │
│   └── assets/                     ← Static assets (hiện rỗng)
│
├── public/
│   ├── favicon.svg                 ← Icon tab trình duyệt
│   ├── icons.svg                   ← SVG icon sprites
│   └── data/                       ← Static JSON data (served trực tiếp, không qua API)
│       ├── drugs.json              ← 17,430 thuốc (13.2MB) — dùng cho DrugsPage
│       ├── proteins.json           ← 5,206 protein (967KB) — dùng cho ProteinsPage
│       └── drug_categories.json    ← 13 nhóm bệnh × 20 thuốc — dùng cho InteractionsPage
│
├── index.html                      ← Root HTML — mount point #root, tiêu đề trang
├── vite.config.ts                  ← Vite config — proxy /api/* → localhost:8000
├── tailwind.config.js              ← Tailwind — màu custom (primary-navy), font Inter
├── tsconfig.json                   ← TypeScript config gốc
├── tsconfig.app.json               ← TypeScript config cho src/
├── tsconfig.node.json              ← TypeScript config cho Vite config files
├── postcss.config.js               ← PostCSS — cần cho Tailwind
├── eslint.config.js                ← ESLint config (TypeScript + React rules)
├── package.json                    ← Dependencies + scripts (dev, build, lint)
└── package-lock.json               ← Lock file — đảm bảo version nhất quán
```

### Chi tiết các file quan trọng

#### `vite.config.ts` — Proxy API
```typescript
// Proxy mọi request /api/* → http://localhost:8000
// Giải quyết CORS khi dev local
server: {
  proxy: {
    '/api': { target: 'http://localhost:8000', changeOrigin: true }
  }
}
```

#### `src/lib/drugCache.ts` — Cache Pattern
```typescript
// Load drugs.json 1 lần duy nhất, tất cả pages dùng chung
let cache: Drug[] | null = null;
export async function getDrugs(): Promise<Drug[]> {
  if (cache) return cache;
  cache = await fetch('/data/drugs.json').then(r => r.json());
  return cache;
}
```

#### `src/pages/InteractionsPage.tsx` — Drug Interaction Checker
```
Luồng:
  1. Load drug_categories.json → hiển thị 13 nhóm bệnh (trái)
  2. User chọn thuốc → thêm vào selectedDrugs (tối đa 8)
  3. Mạng lưới SVG: mỗi thuốc = viên thuốc 3D + protein nodes quay orbit
  4. Nhấn "Check Interactions" → POST /api/v1/analysis/check-interactions
  5. Nếu có tương tác: thuốc bật ra (CSS repel animation)
  6. Nếu không: thuốc hòa vào nhau (không offset)
  7. Click từng cặp → Interaction Details modal
```

#### `src/pages/DrugsPage.tsx` — Drug Browser
```
- Load 17,430 thuốc từ /data/drugs.json qua drugCache
- Search theo tên (real-time)
- Filter theo: nhóm (approved/experimental/...) + type (small molecule/biotech)
- Pagination 24 thuốc/trang
- Click → chuyển tới /drugs/:id
```

#### `public/data/` — Static Data Files
> Các file JSON này được sinh ra từ NDJSON database. Không chỉnh sửa thủ công.
> Để tái tạo: chạy lại `xml_to_json.py` → `json_to_mysql.py`.

---

## 6. Database & Dữ liệu

### Schema MySQL (`cdss`)

```sql
-- Bảng chính
drugs                       -- 17,430 records
proteins                    -- 5,206 records
drug_interactions           -- 24,386+ records
drug_protein_interactions   -- ~100,000+ records
```

### Pipeline import dữ liệu (chạy 1 lần)

```
drugbank_full.xml
      │
      ▼  xml_to_json.py
drugs.ndjson + drug_interactions.ndjson + proteins.ndjson + drug_protein_interactions.ndjson
      │
      ▼  json_to_mysql.py
MySQL database cdss  →  4 bảng
      │
      ▼  (đã có sẵn)
public/data/drugs.json         (từ drugs.ndjson)
public/data/proteins.json      (từ proteins.ndjson + drug_protein_interactions.ndjson)
public/data/drug_categories.json  (tổng hợp theo nhóm bệnh)
```

---

## 7. API Endpoints

### Drug API — `/api/v1/drugs/`
| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/v1/drugs/` | Danh sách thuốc (có filter, phân trang) |
| GET | `/api/v1/drugs/{drugbank_id}` | Chi tiết 1 thuốc |
| GET | `/api/v1/drugs/search?q=aspirin` | Tìm kiếm autocomplete |

### Interaction API — `/api/v1/interactions/`
| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/v1/interactions/` | Danh sách tương tác |
| GET | `/api/v1/interactions/drug/{id}` | Tương tác của 1 thuốc |

### Analysis API — `/api/v1/analysis/`
| Method | Endpoint | Mô tả |
|---|---|---|
| **POST** | `/api/v1/analysis/check-interactions` | **Kiểm tra tương tác nhiều thuốc** |
| POST | `/api/v1/analysis/risk-score` | Tính điểm rủi ro 0–10 |
| POST | `/api/v1/analysis/recommendations` | Gợi ý lâm sàng |

**Ví dụ gọi API:**
```bash
curl -X POST http://localhost:8000/api/v1/analysis/check-interactions \
  -H "Content-Type: application/json" \
  -d '{"drug_ids": ["DB00945", "DB00682", "DB01050"]}'
```

---

## 8. Luồng dữ liệu

```
User (Browser)
    │
    ├─── /drugs, /proteins → React fetches public/data/*.json (static, không qua backend)
    │
    └─── /interactions → React → POST /api/* → Vite Proxy → FastAPI (port 8000)
                                                                  │
                                                             SQLAlchemy
                                                                  │
                                                             MySQL cdss
```

**Tóm tắt:** Dữ liệu tĩnh (danh sách thuốc, protein) được load trực tiếp từ file JSON để tốc độ tối đa. Chỉ phân tích tương tác mới gọi API backend.

---

*Data source: DrugBank® v5 — licensed for academic use · MediDB © 2026*
