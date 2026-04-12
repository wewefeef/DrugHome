# Hướng Dẫn Chi Tiết: Đẩy Dữ Liệu JSON Vào MySQL & Chạy Back-end

## Tổng quan quy trình

```
MySQL Workbench          Terminal / PowerShell         Browser
─────────────────        ─────────────────────         ───────
Tạo database        →    Cài Python packages      →    http://localhost:8000
Kiểm tra kết nối        Chạy json_to_mysql.py
Verify dữ liệu          Chạy uvicorn (backend)
```

**4 bảng sẽ được tạo trong MySQL:**

| Bảng | Số dòng | Nội dung |
|------|---------|---------|
| `drugs` | ~17,430 | Thông tin từng loại thuốc |
| `drug_interactions` | ~2,855,848 | Tương tác thuốc-thuốc |
| `proteins` | ~5,206 | Danh sách protein UniProt |
| `drug_protein_interactions` | ~33,227 | Liên kết thuốc ↔ protein |

---

## PHẦN 1 — MySQL Workbench: Tạo Database

### Bước 1.1 — Mở Query Editor

Trong MySQL Workbench (đã kết nối `127.0.0.1:3306`):
1. Nhấp vào tab **Query 1** ở thanh trên (hoặc nhấn **Ctrl+T** để mở tab mới)
2. Một ô nhập lệnh SQL trống sẽ hiện ra ở giữa màn hình

### Bước 1.2 — Tạo Database

**Copy toàn bộ đoạn SQL dưới đây**, dán vào ô Query, rồi nhấn nút ▶ **Execute** (hoặc **Ctrl+Shift+Enter**):

```sql
-- Tạo database cdss với encoding utf8mb4 hỗ trợ tiếng Việt và ký tự đặc biệt
CREATE DATABASE IF NOT EXISTS cdss
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- Chọn database vừa tạo để làm việc
USE cdss;

-- Xác nhận database đã tạo thành công
SELECT 'Database cdss da tao thanh cong!' AS ket_qua;
```

**Kết quả mong đợi trong ô Output (phía dưới):**
```
1 row(s) affected
Database cdss da tao thanh cong!
```

### Bước 1.3 — Kiểm tra database đã có trong danh sách

1. Nhấp vào tab **Schemas** ở phần dưới trái Navigator
2. Nhấp nút **Refresh** (biểu tượng ↺) nếu chưa thấy
3. Danh sách sẽ hiện ra `cdss` ✅

---

## PHẦN 2 — Cấu hình File `.env`

### Bước 2.1 — Mở file `.env`

Đường dẫn file:
```
d:\Du_an\Back_end\Clinical Decision Support System - cintana\.env
```

Mở bằng Notepad hoặc VS Code.

### Bước 2.2 — Điền thông tin kết nối

Tìm và sửa các dòng sau:

```env
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=cdss
DB_USERNAME=root
DB_PASSWORD=
```

> **Lưu ý:**
> - `DB_PASSWORD=` — để TRỐNG nếu MySQL không có password (mặc định MySQL mới cài)
> - `DB_HOST=127.0.0.1` — không đổi nếu MySQL chạy trên máy bạn
> - `DB_PORT=3306` — port mặc định của MySQL

### Bước 2.3 — Kiểm tra password MySQL của bạn

Trong MySQL Workbench, nhìn thanh tab trên cùng:
- Nếu thấy `Mysql@127.0.0.1:3306` → đây là connection không cần password hoặc đã lưu password
- Nhấn **Database → Manage Connections** để xem lại password đã lưu

---

## PHẦN 3 — Cài đặt Python & Chạy Import

### Bước 3.1 — Mở PowerShell

Nhấn `Win + R` → gõ `powershell` → Enter

Hoặc trong VS Code: nhấn **Ctrl + `** để mở terminal tích hợp

### Bước 3.2 — Cài thư viện Python

```powershell
# Di chuyển vào thư mục dự án
cd "d:\Du_an\Back_end\Clinical Decision Support System - cintana"

# Kích hoạt virtual environment
.\venv\Scripts\Activate.ps1

# Cài thư viện (nếu chưa cài)
pip install pymysql cryptography typer
```

### Bước 3.3 — Test kết nối MySQL trước khi import

Chạy lệnh kiểm tra nhanh:

```powershell
python -c "
import pymysql
conn = pymysql.connect(host='127.0.0.1', port=3306, db='cdss', user='root', password='', charset='utf8mb4')
cur = conn.cursor()
cur.execute('SELECT VERSION()')
print('MySQL version:', cur.fetchone()[0])
print('Ket noi thanh cong!')
conn.close()
"
```

**Nếu in ra** `MySQL version: 8.x.x` → kết nối OK ✅  
**Nếu lỗi** → xem phần Xử lý Lỗi bên dưới

### Bước 3.4 — Chạy Script Import JSON → MySQL

```powershell
# Từ thư mục gốc d:\Du_an\Back_end
cd "d:\Du_an\Back_end"

# Chạy import (sẽ tạo bảng tự động + nạp dữ liệu)
python scripts/json_to_mysql.py
```

### Quá trình import trông như thế này:

```
============================================================
Ket noi MySQL...
   Host    : 127.0.0.1:3306
   Database: cdss
   User    : root
   Data dir: D:\Du_an\Back_end\Database\data
============================================================
Ket noi thanh cong!

Kiem tra / tao bang...
   Bang `drugs` san sang
   Bang `drug_interactions` san sang
   Bang `proteins` san sang
   Bang `drug_protein_interactions` san sang

[1/4] Import drugs.ndjson...
   17,430 thuoc | 45.2s

[2/4] Import drug_interactions.ndjson...
   2,855,848 tuong tac | 382.5s        <- file lon nhat, cho ~6 phut

[3/4] Import proteins.ndjson...
   5,206 protein | 1.8s

[4/4] Import drug_protein_interactions.ndjson...
   33,227 lien ket drug-protein | 12.3s

============================================================
KET QUA CUOI CUNG
============================================================
  drugs                                      17,430 rows
  drug_interactions                       2,855,848 rows
  proteins                                    5,206 rows
  drug_protein_interactions                  33,227 rows

Tong thoi gian: 441.8s
============================================================
Hoan thanh!
```

> ⚠️ **File `drug_interactions.ndjson` nặng 542 MB (~2.8 triệu dòng) — quá trình import mất khoảng 6-10 phút. Đây là bình thường.**

### Các tuỳ chọn khi chạy script:

```powershell
# Nếu password MySQL khác rỗng
python scripts/json_to_mysql.py --password "your_password"

# Chỉnh thư mục data nếu khác mặc định
python scripts/json_to_mysql.py --data-dir "d:/Du_an/Back_end/Database/data"

# Reset bảng rồi import lại từ đầu (xóa data cũ)
python scripts/json_to_mysql.py --reset

# Chỉ import 1 bảng cụ thể (để test)
python scripts/json_to_mysql.py --only drugs
python scripts/json_to_mysql.py --only proteins

# Dùng batch size lớn hơn để nhanh hơn (cần RAM nhiều hơn)
python scripts/json_to_mysql.py --batch 1000
```

---

## PHẦN 4 — Xác nhận Dữ liệu Trong MySQL Workbench

### Bước 4.1 — Mở lại MySQL Workbench

Nhấp vào tab **Schemas** (trái dưới) → nhấp đúp vào **cdss** → nhấp vào **Tables**

Bạn sẽ thấy 4 bảng:
```
▼ cdss
  ▼ Tables
    📋 drug_interactions
    📋 drug_protein_interactions
    📋 drugs
    📋 proteins
```

### Bước 4.2 — Chạy Query kiểm tra

Nhấn **Ctrl+T** để mở Query tab mới, dán và chạy từng đoạn:

```sql
USE cdss;

-- Đếm tổng số dòng mỗi bảng
SELECT 'drugs'                      AS bang, COUNT(*) AS so_dong FROM drugs
UNION ALL
SELECT 'drug_interactions',                  COUNT(*)            FROM drug_interactions
UNION ALL
SELECT 'proteins',                           COUNT(*)            FROM proteins
UNION ALL
SELECT 'drug_protein_interactions',          COUNT(*)            FROM drug_protein_interactions;
```

**Kết quả mong đợi:**
```
bang                              | so_dong
──────────────────────────────────|──────────
drugs                             |   17,430
drug_interactions                 | 2,855,848
proteins                          |    5,206
drug_protein_interactions         |   33,227
```

```sql
USE cdss;
-- Xem 5 thuốc đầu tiên
SELECT drug_code, drugbank_id, name, type, drug_groups
FROM drugs
LIMIT 5;
```

```sql
USE cdss;
-- Xem tương tác của thuốc DR:00001 (Lepirudin)
SELECT di.interacting_drug_id, di.severity, LEFT(di.description, 80) AS mo_ta
FROM drug_interactions di
WHERE di.drug_code = 'DR:00001'
LIMIT 10;
```

```sql
USE cdss;
-- Xem protein của thuốc DR:00001
SELECT p.uniprot_id, p.gene_name, p.name, p.organism,
       dpi.interaction_type, dpi.known_action
FROM drug_protein_interactions dpi
JOIN proteins p ON p.id = dpi.protein_id
WHERE dpi.drug_code = 'DR:00001';
```

```sql
USE cdss;
-- Đếm thuốc theo loại
SELECT type, COUNT(*) AS so_luong
FROM drugs
GROUP BY type
ORDER BY so_luong DESC;
```

```sql
USE cdss;
-- Thuốc có nhiều tương tác nhất (Top 10)
SELECT d.drugbank_id, d.name, COUNT(di.id) AS so_tuong_tac
FROM drugs d
JOIN drug_interactions di ON di.drug_code = d.drug_code
GROUP BY d.drug_code, d.drugbank_id, d.name
ORDER BY so_tuong_tac DESC
LIMIT 10;
```

---

## PHẦN 5 — Chạy Back-end FastAPI

### Bước 5.1 — Chạy server

```powershell
cd "d:\Du_an\Back_end\Clinical Decision Support System - cintana"

# Kích hoạt venv
.\venv\Scripts\Activate.ps1

# Khởi động server (chế độ hot-reload)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**Terminal sẽ hiển thị:**
```
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
INFO:     Started reloader process
INFO:     Application startup complete.
```

### Bước 5.2 — Mở trình duyệt

| URL | Nội dung |
|-----|---------|
| http://localhost:8000 | Trang chủ ứng dụng |
| http://localhost:8000/drugs/ | Danh sách thuốc |
| http://localhost:8000/network-map/ | Bản đồ tương tác |
| http://localhost:8000/admin | Admin panel |
| http://localhost:8000/docs | API documentation (Swagger) |

### Bước 5.3 — Dừng server

Nhấn **Ctrl + C** trong terminal để dừng

---

## PHẦN 6 — Xử Lý Lỗi Thường Gặp

### Lỗi: `Access denied for user 'root'@'localhost'`

```
pymysql.err.OperationalError: (1045, "Access denied for user 'root'@'localhost'")
```

**Cách sửa:**
```powershell
# Thêm password vào lệnh chạy
python scripts/json_to_mysql.py --password "your_password_here"
```

Hoặc sửa lại trong MySQL Workbench:
```sql
-- Đặt lại password root (nếu quên)
ALTER USER 'root'@'localhost' IDENTIFIED BY 'new_password';
FLUSH PRIVILEGES;
```

---

### Lỗi: `Can't connect to MySQL server on '127.0.0.1'`

```
pymysql.err.OperationalError: (2003, "Can't connect to MySQL server")
```

**Cách sửa:**
```powershell
# Kiểm tra MySQL có đang chạy không
Get-Service -Name "MySQL*"

# Nếu Status = Stopped, khởi động lại
Start-Service -Name "MySQL80"
# hoặc
net start MySQL80
```

---

### Lỗi: `Unknown database 'cdss'`

```
pymysql.err.OperationalError: (1049, "Unknown database 'cdss'")
```

**Cách sửa:** Quay lại Bước 1.2 và tạo database trong MySQL Workbench

---

### Lỗi: `No module named 'pymysql'`

```
ModuleNotFoundError: No module named 'pymysql'
```

**Cách sửa:**
```powershell
pip install pymysql cryptography
```

---

### Import chạy rất chậm (drug_interactions)

**Bình thường** — file có ~2.8 triệu dòng. Tùy tốc độ máy:
- SSD: ~6-8 phút
- HDD: ~15-20 phút

Dùng batch lớn hơn để tăng tốc:
```powershell
python scripts/json_to_mysql.py --batch 2000
```

---

### Lỗi Python encoding (Windows)

```
UnicodeDecodeError: 'charmap' codec can't decode...
```

**Cách sửa:**
```powershell
# Đặt encoding UTF-8 cho terminal Windows
$env:PYTHONUTF8 = "1"
python scripts/json_to_mysql.py
```

---

## PHẦN 7 — Tóm Tắt Toàn Bộ Quy Trình

```
BƯỚC 1: MySQL Workbench
  → Tab Query 1
  → Chạy: CREATE DATABASE IF NOT EXISTS cdss CHARACTER SET utf8mb4;

BƯỚC 2: Cấu hình .env
  → Mở: d:\Du_an\Back_end\Clinical Decision Support System - cintana\.env
  → Điền: DB_DATABASE=cdss, DB_USERNAME=root, DB_PASSWORD=

BƯỚC 3: PowerShell
  → cd "d:\Du_an\Back_end\Clinical Decision Support System - cintana"
  → .\venv\Scripts\Activate.ps1
  → pip install pymysql cryptography typer

BƯỚC 4: Import dữ liệu
  → cd "d:\Du_an\Back_end"
  → python scripts/json_to_mysql.py
  → Chờ ~10-15 phút

BƯỚC 5: Verify trong MySQL Workbench
  → Schemas → cdss → Tables
  → Chạy: SELECT COUNT(*) FROM drugs;   -- kết quả: 17430

BƯỚC 6: Chạy Back-end
  → cd "d:\Du_an\Back_end\Clinical Decision Support System - cintana"
  → uvicorn app.main:app --reload --port 8000
  → Mở trình duyệt: http://localhost:8000
```

---

## Cấu trúc Bảng MySQL (Tham khảo)

### Bảng `drugs`
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `drug_code` | VARCHAR(10) PK | Mã nội bộ: DR:00001 |
| `drugbank_id` | VARCHAR(20) UNIQUE | Mã DrugBank: DB00001 |
| `name` | VARCHAR(500) | Tên INN generic |
| `type` | VARCHAR(30) | small molecule / biotech |
| `drug_groups` | VARCHAR(500) | approved\|experimental\|... |
| `atc_codes` | VARCHAR(500) | Mã ATC: B01AE02\|... |
| `categories` | JSON | [{name, mesh_id}, ...] |
| `aliases` | JSON | ["tên khác", ...] |
| `components` | JSON | Muối, hỗn hợp thành phần |
| `chemical_properties` | JSON | smiles, formula, weight |
| `external_mappings` | JSON | {ChEMBL: ..., PubChem: ...} |
| `indication` | LONGTEXT | Chỉ định điều trị |
| `mechanism_of_action` | LONGTEXT | Cơ chế tác dụng |
| `toxicity` | LONGTEXT | Độc tính |

### Bảng `drug_interactions`
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `id` | BIGINT PK | Auto increment |
| `drug_code` | VARCHAR(10) | FK → drugs.drug_code |
| `interacting_drug_id` | VARCHAR(20) | DrugBank ID thuốc đối tác |
| `severity` | VARCHAR(20) | major / moderate / minor / unknown |
| `description` | LONGTEXT | Mô tả tương tác |

### Bảng `proteins`
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `id` | INT PK | Sequential ID |
| `uniprot_id` | VARCHAR(20) UNIQUE | UniProtKB ID: P00734 |
| `entrez_gene_id` | VARCHAR(30) | NCBI Gene ID |
| `organism` | VARCHAR(200) | Human / Mouse / ... |
| `name` | VARCHAR(500) | Tên protein |
| `gene_name` | VARCHAR(100) | Tên gene: F2, CYP3A4 |

### Bảng `drug_protein_interactions`
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `id` | BIGINT PK | Auto increment |
| `drug_code` | VARCHAR(10) | FK → drugs.drug_code |
| `uniprot_id` | VARCHAR(20) | UniProt ID |
| `interaction_type` | VARCHAR(20) | target / enzyme / transporter / carrier |
| `known_action` | VARCHAR(20) | yes / no / unknown |
| `actions` | JSON | ["inhibitor", "blocker", ...] |
| `pubmed_ids` | JSON | ["12345678", ...] |

### Option A: MySQL Community Server (Local)

1. Tải tại: https://dev.mysql.com/downloads/mysql/
2. Chọn **MySQL Community Server 8.0+**
3. Cài đặt, ghi nhớ **root password** lúc cài
4. Đảm bảo MySQL đang chạy:

```powershell
# Kiểm tra service MySQL
Get-Service -Name "MySQL*"

# Nếu chưa chạy, khởi động:
Start-Service -Name "MySQL80"
```

### Option B: XAMPP (dễ hơn nếu đã có)

1. Mở **XAMPP Control Panel**
2. Nhấn **Start** bên cạnh **MySQL**
3. MySQL chạy ở `127.0.0.1:3306`, user `root`, password trống

### Option C: MySQL đã có sẵn (bỏ qua bước này)

---

## Bước 2 — Tạo Database và User

Mở MySQL client (MySQL Workbench, HeidiSQL, hoặc terminal):

```sql
-- Kết nối vào MySQL với user root
-- mysql -u root -p

-- Tạo database
CREATE DATABASE cdss
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- (Khuyến nghị) Tạo user riêng thay vì dùng root
CREATE USER 'cdss_user'@'localhost' IDENTIFIED BY 'your_strong_password';
GRANT ALL PRIVILEGES ON cdss.* TO 'cdss_user'@'localhost';
FLUSH PRIVILEGES;

-- Kiểm tra
SHOW DATABASES;
```

> **Nếu dùng root trực tiếp**, bỏ qua phần tạo user, dùng `root` và password root của bạn.

---

## Bước 3 — Cấu hình file `.env`

Mở file `.env` tại:
```
d:\Du_an\Back_end\Clinical Decision Support System - cintana\.env
```

Chỉnh sửa các dòng sau:

```env
# Kết nối MySQL
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=cdss
DB_USERNAME=root
DB_PASSWORD=your_password_here
```

**Ví dụ thực tế với XAMPP (password rỗng):**
```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=cdss
DB_USERNAME=root
DB_PASSWORD=
```

**Ví dụ với user riêng:**
```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=cdss
DB_USERNAME=cdss_user
DB_PASSWORD=your_strong_password
```

---

## Bước 4 — Cài đặt Dependencies Python

Mở PowerShell tại thư mục dự án:

```powershell
cd "d:\Du_an\Back_end\Clinical Decision Support System - cintana"

# Kích hoạt virtual environment (nếu có)
.\venv\Scripts\Activate.ps1

# Cài tất cả dependencies
pip install -r requirements.txt
```

Kiểm tra kết nối MySQL hoạt động:

```powershell
python -c "
from app.config import get_settings
from app.database import engine
from sqlalchemy import text

settings = get_settings()
print('URL:', settings.database_url)

with engine.connect() as conn:
    result = conn.execute(text('SELECT VERSION()'))
    print('MySQL version:', result.scalar())
    print('Ket noi thanh cong!')
"
```

Nếu in ra `MySQL version: 8.x.x` → kết nối thành công ✅

---

## Bước 5 — Tạo Bảng Bằng Alembic

Alembic sẽ tự động tạo đúng schema bảng trong MySQL.

```powershell
cd "d:\Du_an\Back_end\Clinical Decision Support System - cintana"

# Tạo file migration lần đầu (autogenerate từ models.py)
alembic revision --autogenerate -m "initial_schema"

# Chạy migration → tạo bảng trong MySQL
alembic upgrade head
```

Kiểm tra bảng đã tạo:

```sql
USE cdss;
SHOW TABLES;
-- Kết quả phải có: drugs_drug
DESCRIBE drugs_drug;
```

> **Lưu ý:** Nếu cần chạy lại từ đầu (xóa hết và tạo mới):
> ```powershell
> alembic downgrade base   # xóa tất cả bảng
> alembic upgrade head     # tạo lại
> ```

---

## Bước 6 — Import Dữ liệu DrugBank vào MySQL

Dùng script `load_drugbank.py` để đọc file XML và đẩy thẳng vào MySQL:

```powershell
cd "d:\Du_an\Back_end\Clinical Decision Support System - cintana"

# Import toàn bộ 17,430 thuốc (mất khoảng 30-60 phút tùy máy)
python -m scripts.load_drugbank "d:\Du_an\Back_end\Database\drugbank_full.xml"
```

### Các tuỳ chọn hữu ích:

```powershell
# Xem progress mỗi 100 thuốc
python -m scripts.load_drugbank "d:\Du_an\Back_end\Database\drugbank_full.xml" --progress 100

# Reset bảng rồi import lại (xóa data cũ trước)
python -m scripts.load_drugbank "d:\Du_an\Back_end\Database\drugbank_full.xml" --reset

# Test nhanh: chỉ import 1 thuốc để kiểm tra
python -m scripts.load_drugbank "d:\Du_an\Back_end\Database\drugbank_full.xml" --only DB00001

# Import batch size tùy chỉnh (mặc định 100)
python -m scripts.load_drugbank "d:\Du_an\Back_end\Database\drugbank_full.xml" --batch 200
```

### Theo dõi tiến độ mẫu:

```
Starting database import from drugbank_full.xml...
Detected namespace: {http://www.drugbank.ca}
Progress: seen=500   saved=498  skipped=2  failed=0
Progress: seen=1000  saved=996  skipped=4  failed=0
...
DONE! seen=17430 saved=17425 skipped=5 failed=0.
```

---

## Bước 7 — Khởi động Ứng dụng

```powershell
cd "d:\Du_an\Back_end\Clinical Decision Support System - cintana"

# Chạy server development
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Mở trình duyệt:
- **Ứng dụng chính:** http://localhost:8000
- **Admin panel:**   http://localhost:8000/admin
- **API docs:**      http://localhost:8000/docs

---

## Xử lý Lỗi Thường Gặp

### Lỗi: `Access denied for user`

```
sqlalchemy.exc.OperationalError: (pymysql.err.OperationalError)
(1045, "Access denied for user 'root'@'localhost'")
```

**Nguyên nhân:** Sai password trong `.env`  
**Cách sửa:** Kiểm tra lại `DB_PASSWORD` trong `.env`

---

### Lỗi: `Can't connect to MySQL server`

```
(2003, "Can't connect to MySQL server on '127.0.0.1'")
```

**Nguyên nhân:** MySQL chưa chạy hoặc sai port  
**Cách sửa:**
```powershell
# Khởi động lại MySQL
Start-Service -Name "MySQL80"
# hoặc mở XAMPP → Start MySQL
```

---

### Lỗi: `Unknown database 'cdss'`

```
(1049, "Unknown database 'cdss'")
```

**Nguyên nhân:** Chưa tạo database  
**Cách sửa:** Chạy lại lệnh SQL ở Bước 2

---

### Lỗi: `Table doesn't exist`

```
sqlalchemy.exc.ProgrammingError: Table 'cdss.drugs_drug' doesn't exist
```

**Nguyên nhân:** Chưa chạy Alembic  
**Cách sửa:** Chạy lại Bước 5

---

### Lỗi: `No module named 'pymysql'`

```
ModuleNotFoundError: No module named 'pymysql'
```

**Cách sửa:**
```powershell
pip install pymysql cryptography
```

---

## Kiểm Tra Nhanh Sau Khi Import

```sql
USE cdss;

-- Đếm tổng số thuốc
SELECT COUNT(*) AS total_drugs FROM drugs_drug;
-- Kết quả: ~17,430

-- Xem 5 thuốc đầu tiên
SELECT drugbank_id, name, drug_type, state FROM drugs_drug LIMIT 5;

-- Đếm thuốc có tương tác
SELECT COUNT(*) FROM drugs_drug WHERE JSON_LENGTH(interactions) > 0;

-- Đếm thuốc có dữ liệu gene
SELECT COUNT(*) FROM drugs_drug WHERE JSON_LENGTH(genomics) > 0;
```

---

## Tóm Tắt Nhanh

| Bước | Lệnh | Ghi chú |
|------|------|---------|
| Tạo DB | `CREATE DATABASE cdss CHARACTER SET utf8mb4` | Chạy trong MySQL |
| Cấu hình | Sửa file `.env` | DB_HOST, DB_PASSWORD |
| Cài thư viện | `pip install -r requirements.txt` | Trong thư mục dự án |
| Tạo bảng | `alembic upgrade head` | Chạy 1 lần |
| Import data | `python -m scripts.load_drugbank drugbank_full.xml` | Mất 30-60 phút |
| Chạy web | `uvicorn app.main:app --reload` | http://localhost:8000 |
