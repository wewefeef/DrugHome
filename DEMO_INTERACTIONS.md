# Hướng dẫn Demo Tương tác Thuốc — MediDB

> **Dữ liệu thực tế đã import vào Railway MySQL:**
> - 17,430 thuốc | 4,550 cặp tương tác (1,352 MAJOR + 3,198 minor) | 5,206 protein | 33,227 drug-protein links
> - Lý do nhiều cặp hiển thị "No interaction": chỉ 4,550 cặp có severity (major/minor) được import,
>   2.85 triệu cặp "unknown severity" bị bỏ để tiết kiệm disk space Railway.

---

## KỊCH BẢN DEMO TỐT NHẤT

### 🔴 Kịch bản 1 — Thuốc ức chế miễn dịch + Thuốc huyết áp (MAJOR × 3)

**Chọn 3 thuốc này vào ô tương tác:**

| Thuốc | DrugBank ID | Tìm kiếm bằng |
|-------|-------------|---------------|
| Ramipril | DB00178 | Gõ "Ramipril" |
| Lisinopril | DB00722 | Gõ "Lisinopril" |
| Azathioprine | DB00993 | Gõ "Azathioprine" |

**Kết quả mong đợi:**
- ⚠️ **MAJOR** Ramipril + Azathioprine → tăng nguy cơ ức chế tủy xương, thiếu máu, giảm bạch cầu nặng
- ⚠️ **MAJOR** Lisinopril + Azathioprine → tương tự
- ✓ Ramipril + Lisinopril → No interaction (cùng nhóm ACE inhibitor, không dùng phối hợp trong thực tế)

---

### 🔴 Kịch bản 2 — Opioid + Benzodiazepine (MAJOR × 3, nguy cơ tử vong)

**Chọn 3 thuốc này:**

| Thuốc | DrugBank ID | Tìm kiếm bằng |
|-------|-------------|---------------|
| Oliceridine | DB14881 | Gõ "Oliceridine" |
| Lorazepam | DB00186 | Gõ "Lorazepam" |
| Morphine | DB00295 | Gõ "Morphine" |

**Kết quả mong đợi:**
- ⚠️ **MAJOR** Oliceridine + Lorazepam → tăng nguy cơ hạ huyết áp, an thần, **tử vong**, suy hô hấp
- ⚠️ **MAJOR** Oliceridine + Morphine → tương tự
- (Lorazepam + Morphine — kết quả tùy dữ liệu)

---

### 🔴 Kịch bản 3 — Opioid + Thuốc thần kinh (MAJOR × 3)

**Chọn 3 thuốc này:**

| Thuốc | DrugBank ID | Tìm kiếm bằng |
|-------|-------------|---------------|
| Tramadol | DB00193 | Gõ "Tramadol" |
| Fluoxetine | DB00472 | Gõ "Fluoxetine" |
| Oliceridine | DB14881 | Gõ "Oliceridine" |

**Kết quả mong đợi:**
- ⚠️ **MAJOR** Tramadol + Oliceridine → nguy cơ ức chế hô hấp
- ⚠️ **MAJOR** Fluoxetine + Oliceridine → nguy cơ serotonin syndrome + ức chế hô hấp

---

### 🟡 Kịch bản 4 — Thuốc ung thư (MAJOR)

**Chọn 2 thuốc:**

| Thuốc | DrugBank ID | Tìm kiếm bằng |
|-------|-------------|---------------|
| Sorafenib | DB00398 | Gõ "Sorafenib" |
| Carboplatin | DB00958 | Gõ "Carboplatin" |

**Kết quả mong đợi:**
- ⚠️ **MAJOR** Sorafenib + Carboplatin → tăng nguy cơ tử vong

---

### 🔴 Kịch bản 5 — Demo đầy đủ nhất (4 thuốc, nhiều cặp MAJOR)

**Chọn 4 thuốc:**

| Thuốc | DrugBank ID | Tìm kiếm bằng |
|-------|-------------|---------------|
| Ramipril | DB00178 | Gõ "Ramipril" |
| Azathioprine | DB00993 | Gõ "Azathioprine" |
| Lorazepam | DB00186 | Gõ "Lorazepam" |
| Oliceridine | DB14881 | Gõ "Oliceridine" |

**Kết quả mong đợi (6 cặp):**
- ⚠️ **MAJOR** Ramipril + Azathioprine
- ⚠️ **MAJOR** Lorazepam + Oliceridine
- ✓ Các cặp còn lại → No interaction

---

## TẠI SAO CẶP Cefotiam + Doxycycline KHÔNG CÓ TƯƠNG TÁC?

```
Cefotiam, Aminosalicylic acid, Doxycycline, Idoxuridine
→ Không có trong 4,550 cặp major/minor của DrugBank v5
→ DrugBank chưa ghi nhận tương tác có mức độ đáng kể giữa các thuốc này
```

Điều này là **đúng về mặt lâm sàng** — đây là các kháng sinh/kháng virus riêng biệt không có tương tác nguy hiểm đã được ghi nhận.

---

## THỐNG KÊ DỮ LIỆU HIỆN TẠI

| Bảng | Số lượng | Ghi chú |
|------|----------|---------|
| drugs | 17,430 | Thuốc từ DrugBank v5 |
| drug_interactions | 4,550 | Chỉ major + minor (1,352 major + 3,198 minor) |
| proteins | 5,206 | Protein targets/enzymes |
| drug_protein_interactions | 33,227 | Liên kết thuốc-protein |

> **Lý do không import 2.85 triệu cặp "unknown":** Railway MySQL free tier ~500MB disk.
> Nếu nâng cấp Railway, có thể import toàn bộ để hiển thị nhiều tương tác hơn.

---

## CÁCH TÌM THUỐC TRÊN WEBSITE

1. Vào **drug-home.vercel.app/interactions**
2. Dùng thanh tìm kiếm bên trái: gõ tên thuốc tiếng Anh
3. Click tên thuốc để thêm vào danh sách
4. Thêm đủ 2+ thuốc → kết quả hiện tự động
5. Bấm **"Tự động lưu"** → phiên được lưu vào trang **Phân tích**
