"""
Export API — Streaming CSV/JSON cho các bảng lớn
=================================================
Giải quyết vấn đề sqladmin export bị giới hạn / timeout với 2.8M rows.

Routes
------
GET /api/v1/export/interactions          → CSV/JSON toàn bộ drug_interactions
GET /api/v1/export/interactions/unique   → CSV/JSON chỉ cặp unique (dedup A↔B)
GET /api/v1/export/drugs                 → CSV/JSON toàn bộ drugs
GET /api/v1/export/proteins              → CSV/JSON toàn bộ proteins
GET /api/v1/export/drug-protein          → CSV/JSON drug_protein_interactions

Tất cả endpoint đều:
  - Yêu cầu admin authentication (Bearer token của admin user)
  - Dùng StreamingResponse + generator → không load toàn bộ vào RAM
  - Batch 5,000 rows mỗi lần query → tránh timeout MySQL
  - Hỗ trợ filter theo severity (interactions), drug_type (drugs), protein_type
"""

from __future__ import annotations

import csv
import io
import json
import logging
from typing import Generator, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.routers.api_auth import require_admin, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/export", tags=["Export"])

# Batch size — số rows mỗi lần SELECT để tránh OOM với 2.8M rows
_BATCH = 5_000


# ── Helpers ───────────────────────────────────────────────────────────────────

def _csv_stream(headers: list[str], rows_gen: Generator) -> Generator[str, None, None]:
    """Yield CSV lines từ generator rows, dùng StringIO buffer."""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    # Header
    writer.writerow(headers)
    yield buf.getvalue()
    buf.seek(0); buf.truncate(0)
    # Data rows
    for row in rows_gen:
        writer.writerow(row)
        yield buf.getvalue()
        buf.seek(0); buf.truncate(0)


def _json_stream(headers: list[str], rows_gen: Generator) -> Generator[str, None, None]:
    """Yield JSON array lines (JSON Lines format — 1 object per line)."""
    for row in rows_gen:
        obj = dict(zip(headers, row))
        yield json.dumps(obj, ensure_ascii=False, default=str) + "\n"


def _make_response(
    fmt: str,
    filename: str,
    headers: list[str],
    rows_gen: Generator,
) -> StreamingResponse:
    if fmt == "json":
        return StreamingResponse(
            _json_stream(headers, rows_gen),
            media_type="application/x-ndjson",
            headers={"Content-Disposition": f'attachment; filename="{filename}.jsonl"'},
        )
    # default: csv
    return StreamingResponse(
        _csv_stream(headers, rows_gen),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}.csv"'},
    )


# ── 1. Drug Interactions — toàn bộ (có filter severity) ──────────────────────

@router.get(
    "/interactions",
    summary="Export drug_interactions (streaming CSV/JSON)",
    description="""
Export toàn bộ bảng `drug_interactions` dưới dạng streaming CSV hoặc JSON Lines.

- Không giới hạn số dòng — stream trực tiếp từ DB theo batch 5,000 rows
- Filter theo `severity`: major | moderate | minor | unknown
- `fmt=csv` (mặc định) hoặc `fmt=json` (JSON Lines, 1 object/dòng)
- Yêu cầu đăng nhập admin
    """,
)
def export_interactions(
    fmt: str = Query(default="csv", description="csv hoặc json"),
    severity: Optional[str] = Query(default=None, description="Lọc: major | moderate | minor | unknown"),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> StreamingResponse:

    headers = ["id", "drug_id", "drug_name", "interacting_drug_id",
               "interacting_drug_name", "severity", "description"]

    where = "WHERE di.severity = :sev" if severity else ""
    params: dict = {"sev": severity} if severity else {}

    def rows_gen() -> Generator:
        offset = 0
        while True:
            q = text(
                f"SELECT di.id, di.drug_id, di.drug_name, "
                f"       di.interacting_drug_id, di.interacting_drug_name, "
                f"       di.severity, di.description "
                f"FROM drug_interactions di "
                f"{where} "
                f"ORDER BY di.id "
                f"LIMIT {_BATCH} OFFSET :offset"
            )
            batch = db.execute(q, {**params, "offset": offset}).fetchall()
            if not batch:
                break
            for row in batch:
                yield list(row)
            offset += _BATCH
            if len(batch) < _BATCH:
                break

    sev_suffix = f"_{severity}" if severity else "_all"
    filename = f"drug_interactions{sev_suffix}"
    return _make_response(fmt, filename, headers, rows_gen())


# ── 2. Drug Interactions — chỉ cặp unique (dedup A↔B = B↔A) ─────────────────

@router.get(
    "/interactions/unique",
    summary="Export drug_interactions unique pairs (dedup A↔B, streaming)",
    description="""
Export chỉ các cặp tương tác unique — loại bỏ trùng lặp A↔B = B↔A.

Dùng `LEAST/GREATEST` để chuẩn hoá chiều, sau đó `GROUP BY` lấy severity cao nhất.
Số dòng output = ~1,427,924 (một nửa so với toàn bộ 2,855,848).
    """,
)
def export_interactions_unique(
    fmt: str = Query(default="csv", description="csv hoặc json"),
    severity: Optional[str] = Query(default=None, description="Lọc: major | moderate | minor | unknown"),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> StreamingResponse:

    headers = ["drug_a_id", "drug_b_id", "drug_a_name", "drug_b_name",
               "severity", "description"]

    sev_filter = "AND severity = :sev" if severity else ""
    params: dict = {"sev": severity} if severity else {}

    def rows_gen() -> Generator:
        offset = 0
        while True:
            # Lấy cặp unique: LEAST/GREATEST đảm bảo (A,B) = (B,A)
            # Với mỗi cặp, lấy row có severity cao nhất (major > moderate > minor)
            q = text(
                "SELECT "
                "  LEAST(drug_id, interacting_drug_id)    AS drug_a_id, "
                "  GREATEST(drug_id, interacting_drug_id) AS drug_b_id, "
                "  MAX(CASE WHEN drug_id < interacting_drug_id THEN drug_name "
                "           ELSE interacting_drug_name END) AS drug_a_name, "
                "  MAX(CASE WHEN drug_id < interacting_drug_id THEN interacting_drug_name "
                "           ELSE drug_name END) AS drug_b_name, "
                "  MAX(CASE severity "
                "        WHEN 'major'    THEN 4 "
                "        WHEN 'moderate' THEN 3 "
                "        WHEN 'minor'    THEN 2 "
                "        ELSE 1 END) AS sev_rank, "
                "  SUBSTRING_INDEX(GROUP_CONCAT(severity ORDER BY "
                "    CASE severity WHEN 'major' THEN 4 WHEN 'moderate' THEN 3 "
                "    WHEN 'minor' THEN 2 ELSE 1 END DESC), ',', 1) AS severity, "
                "  SUBSTRING_INDEX(GROUP_CONCAT(description ORDER BY "
                "    CASE severity WHEN 'major' THEN 4 WHEN 'moderate' THEN 3 "
                "    WHEN 'minor' THEN 2 ELSE 1 END DESC SEPARATOR '|||'), '|||', 1) AS description "
                "FROM drug_interactions "
                f"WHERE 1=1 {sev_filter} "
                "GROUP BY drug_a_id, drug_b_id "
                f"ORDER BY drug_a_id, drug_b_id "
                f"LIMIT {_BATCH} OFFSET :offset"
            )
            batch = db.execute(q, {**params, "offset": offset}).fetchall()
            if not batch:
                break
            for row in batch:
                # Trả về: drug_a_id, drug_b_id, drug_a_name, drug_b_name, severity, description
                yield [row[0], row[1], row[2], row[3], row[5], row[6]]
            offset += _BATCH
            if len(batch) < _BATCH:
                break

    sev_suffix = f"_{severity}" if severity else "_all"
    filename = f"drug_interactions_unique{sev_suffix}"
    return _make_response(fmt, filename, headers, rows_gen())


# ── 3. Drugs ──────────────────────────────────────────────────────────────────

@router.get(
    "/drugs",
    summary="Export drugs table (streaming CSV/JSON)",
)
def export_drugs(
    fmt: str = Query(default="csv", description="csv hoặc json"),
    drug_type: Optional[str] = Query(default=None, description="Lọc: small molecule | biotech"),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> StreamingResponse:

    headers = ["drugbank_id", "name", "type", "state", "cas_number",
               "molecular_formula", "average_mass", "atc_codes",
               "description", "indication", "mechanism_of_action"]

    where = "WHERE type = :dtype" if drug_type else ""
    params: dict = {"dtype": drug_type} if drug_type else {}

    def rows_gen() -> Generator:
        offset = 0
        while True:
            q = text(
                "SELECT drugbank_id, name, type, state, cas_number, "
                "       molecular_formula, average_mass, atc_codes, "
                "       LEFT(description, 500), LEFT(indication, 500), "
                "       LEFT(mechanism_of_action, 500) "
                f"FROM drugs {where} "
                f"ORDER BY drugbank_id "
                f"LIMIT {_BATCH} OFFSET :offset"
            )
            batch = db.execute(q, {**params, "offset": offset}).fetchall()
            if not batch:
                break
            for row in batch:
                yield list(row)
            offset += _BATCH
            if len(batch) < _BATCH:
                break

    filename = f"drugs{'_' + drug_type.replace(' ', '_') if drug_type else '_all'}"
    return _make_response(fmt, filename, headers, rows_gen())


# ── 4. Proteins ───────────────────────────────────────────────────────────────

@router.get(
    "/proteins",
    summary="Export proteins table (streaming CSV/JSON)",
)
def export_proteins(
    fmt: str = Query(default="csv", description="csv hoặc json"),
    protein_type: Optional[str] = Query(default=None, description="Lọc: target | enzyme | transporter | carrier"),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> StreamingResponse:

    headers = ["id", "uniprot_id", "name", "gene_name",
               "protein_type", "organism", "general_function"]

    where = "WHERE protein_type = :ptype" if protein_type else ""
    params: dict = {"ptype": protein_type} if protein_type else {}

    def rows_gen() -> Generator:
        offset = 0
        while True:
            q = text(
                "SELECT id, uniprot_id, name, gene_name, "
                "       protein_type, organism, LEFT(general_function, 300) "
                f"FROM proteins {where} "
                f"ORDER BY id "
                f"LIMIT {_BATCH} OFFSET :offset"
            )
            batch = db.execute(q, {**params, "offset": offset}).fetchall()
            if not batch:
                break
            for row in batch:
                yield list(row)
            offset += _BATCH
            if len(batch) < _BATCH:
                break

    filename = f"proteins{'_' + protein_type if protein_type else '_all'}"
    return _make_response(fmt, filename, headers, rows_gen())


# ── 5. Drug-Protein Interactions ──────────────────────────────────────────────

@router.get(
    "/drug-protein",
    summary="Export drug_protein_interactions (streaming CSV/JSON)",
)
def export_drug_protein(
    fmt: str = Query(default="csv", description="csv hoặc json"),
    interaction_type: Optional[str] = Query(default=None, description="Lọc: target | enzyme | transporter | carrier"),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> StreamingResponse:

    headers = ["id", "drug_id", "drug_name", "protein_id",
               "uniprot_id", "gene_name", "interaction_type", "known_action"]

    where = "WHERE dpi.interaction_type = :itype" if interaction_type else ""
    params: dict = {"itype": interaction_type} if interaction_type else {}

    def rows_gen() -> Generator:
        offset = 0
        while True:
            q = text(
                "SELECT dpi.id, dpi.drug_id, d.name AS drug_name, "
                "       dpi.protein_id, dpi.uniprot_id, p.gene_name, "
                "       dpi.interaction_type, dpi.known_action "
                "FROM drug_protein_interactions dpi "
                "LEFT JOIN drugs d ON d.drugbank_id = dpi.drug_id "
                "LEFT JOIN proteins p ON p.id = dpi.protein_id "
                f"{where} "
                f"ORDER BY dpi.id "
                f"LIMIT {_BATCH} OFFSET :offset"
            )
            batch = db.execute(q, {**params, "offset": offset}).fetchall()
            if not batch:
                break
            for row in batch:
                yield list(row)
            offset += _BATCH
            if len(batch) < _BATCH:
                break

    filename = f"drug_protein_interactions{'_' + interaction_type if interaction_type else '_all'}"
    return _make_response(fmt, filename, headers, rows_gen())
