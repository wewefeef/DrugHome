#!/usr/bin/env python3
"""
JSON → MySQL Importer
======================
Đọc 4 file NDJSON và tạo + nạp dữ liệu vào MySQL.

Tạo 4 bảng:
  drugs                      - Thông tin thuốc
  drug_interactions          - Tương tác thuốc-thuốc
  proteins                   - Protein (UniProt)
  drug_protein_interactions  - Liên kết thuốc ↔ protein

Usage:
  python scripts/json_to_mysql.py
  python scripts/json_to_mysql.py --host 127.0.0.1 --port 3306 --db cdss --user root --password ""
  python scripts/json_to_mysql.py --data-dir "d:/Du_an/Back_end/Database/data" --reset
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Optional

try:
    import pymysql
    import pymysql.cursors
except ImportError:
    print("[LỖI] Thiếu thư viện pymysql. Chạy: pip install pymysql cryptography")
    sys.exit(1)

try:
    import typer
except ImportError:
    print("[LỖI] Thiếu thư viện typer. Chạy: pip install typer")
    sys.exit(1)

app = typer.Typer(help="Import 4 NDJSON files → MySQL (drugs, interactions, proteins, dpi)")

# ---------------------------------------------------------------------------
# DDL — Tạo bảng
# ---------------------------------------------------------------------------

DDL_DRUGS = """
CREATE TABLE IF NOT EXISTS drugs (
    drug_code           VARCHAR(10)  NOT NULL,
    drugbank_id         VARCHAR(20)  NOT NULL,
    name                VARCHAR(500) NOT NULL,
    type                VARCHAR(30)  DEFAULT '',
    drug_groups         VARCHAR(500) DEFAULT '',
    atc_codes           VARCHAR(500) DEFAULT '',
    inchikey            VARCHAR(200) DEFAULT '',
    inchi               TEXT,
    description         LONGTEXT,
    indication          LONGTEXT,
    mechanism_of_action LONGTEXT,
    pharmacodynamics    LONGTEXT,
    toxicity            LONGTEXT,
    metabolism          LONGTEXT,
    absorption          LONGTEXT,
    half_life           TEXT,
    protein_binding     TEXT,
    route_of_elimination TEXT,
    categories          JSON,
    aliases             JSON,
    components          JSON,
    chemical_properties JSON,
    external_mappings   JSON,
    cas_number          VARCHAR(50)  DEFAULT '',
    unii                VARCHAR(50)  DEFAULT '',
    state               VARCHAR(20)  DEFAULT '',
    PRIMARY KEY (drug_code),
    UNIQUE KEY uq_drugbank_id (drugbank_id),
    KEY idx_name (name(100)),
    KEY idx_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

DDL_DRUG_INTERACTIONS = """
CREATE TABLE IF NOT EXISTS drug_interactions (
    id                  BIGINT       NOT NULL AUTO_INCREMENT,
    drug_id             VARCHAR(10)  NOT NULL,
    interacting_drug_id VARCHAR(20)  NOT NULL,
    severity            VARCHAR(20)  DEFAULT 'unknown',
    description         TEXT,
    PRIMARY KEY (id),
    KEY idx_drug_id (drug_id),
    KEY idx_interacting (interacting_drug_id),
    KEY idx_severity (severity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

DDL_PROTEINS = """
CREATE TABLE IF NOT EXISTS proteins (
    id              INT          NOT NULL,
    uniprot_id      VARCHAR(20)  NOT NULL,
    entrez_gene_id  VARCHAR(30)  DEFAULT NULL,
    organism        VARCHAR(200) DEFAULT '',
    name            VARCHAR(500) DEFAULT '',
    gene_name       VARCHAR(100) DEFAULT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_uniprot (uniprot_id),
    KEY idx_gene_name (gene_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

DDL_DPI = """
CREATE TABLE IF NOT EXISTS drug_protein_interactions (
    id               BIGINT      NOT NULL AUTO_INCREMENT,
    drug_id          VARCHAR(10) NOT NULL,
    protein_id       INT         NOT NULL,
    uniprot_id       VARCHAR(20) NOT NULL,
    interaction_type VARCHAR(20) DEFAULT '',
    known_action     VARCHAR(20) DEFAULT 'unknown',
    actions          JSON,
    pubmed_ids       JSON,
    PRIMARY KEY (id),
    KEY idx_drug (drug_id),
    KEY idx_protein (protein_id),
    KEY idx_type (interaction_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def j(val) -> str:
    """Convert Python value → JSON string for MySQL JSON column."""
    if val is None:
        return "null"
    return json.dumps(val, ensure_ascii=False, default=str)


def connect(host, port, db, user, password) -> pymysql.Connection:
    return pymysql.connect(
        host=host,
        port=port,
        db=db,
        user=user,
        password=password,
        charset="utf8mb4",
        autocommit=False,
        cursorclass=pymysql.cursors.Cursor,
        connect_timeout=30,
    )


def run_ddl(conn, ddl: str, table_name: str):
    with conn.cursor() as cur:
        cur.execute(ddl)
    conn.commit()
    typer.echo(f"   ✅ Bảng `{table_name}` sẵn sàng")


def count_table(conn, table: str) -> int:
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) FROM `{table}`")
        return cur.fetchone()[0]


def truncate_table(conn, table: str):
    with conn.cursor() as cur:
        cur.execute(f"SET FOREIGN_KEY_CHECKS=0")
        cur.execute(f"TRUNCATE TABLE `{table}`")
        cur.execute(f"SET FOREIGN_KEY_CHECKS=1")
    conn.commit()


# ---------------------------------------------------------------------------
# Import functions
# ---------------------------------------------------------------------------

def import_drugs(conn, ndjson_path: Path, batch_size: int) -> int:
    sql = """
    INSERT INTO drugs
        (drug_code, drugbank_id, name, type, drug_groups, atc_codes,
         inchikey, inchi, description, indication,
         mechanism_of_action, pharmacodynamics, toxicity, metabolism,
         absorption, half_life, protein_binding, route_of_elimination,
         categories, aliases, components, chemical_properties, external_mappings,
         cas_number, unii, state)
    VALUES (%s,%s,%s,%s,%s,%s, %s,%s,%s,%s, %s,%s,%s,%s, %s,%s,%s,%s,
            %s,%s,%s,%s,%s, %s,%s,%s)
    ON DUPLICATE KEY UPDATE
        name=VALUES(name), type=VALUES(type), drug_groups=VALUES(drug_groups)
    """
    total = 0
    batch = []

    def flush():
        nonlocal total
        with conn.cursor() as cur:
            cur.executemany(sql, batch)
        conn.commit()
        total += len(batch)
        batch.clear()

    with open(ndjson_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            cp = d.get("chemical_properties") or {}
            batch.append((
                d.get("drug_code", ""),
                d.get("drugbank_id", ""),
                (d.get("name") or "")[:500],
                (d.get("type") or "")[:30],
                (d.get("groups") or "")[:500],
                (d.get("atc_codes") or "")[:500],
                (d.get("inchikey") or "")[:200],
                d.get("inchi") or "",
                d.get("description") or "",
                d.get("indication") or "",
                d.get("mechanism_of_action") or "",
                d.get("pharmacodynamics") or "",
                d.get("toxicity") or "",
                d.get("metabolism") or "",
                d.get("absorption") or "",
                d.get("half_life") or "",
                d.get("protein_binding") or "",
                d.get("route_of_elimination") or "",
                j(d.get("categories")),
                j(d.get("aliases")),
                j(d.get("components")),
                j(cp),
                j(d.get("external_mappings")),
                (d.get("cas_number") or "")[:50],
                (d.get("unii") or "")[:50],
                (d.get("state") or "")[:20],
            ))
            if len(batch) >= batch_size:
                flush()

    if batch:
        flush()
    return total


def import_drug_interactions(conn, ndjson_path: Path, batch_size: int) -> int:
    sql = """
    INSERT INTO drug_interactions
        (drug_id, interacting_drug_id, severity, description)
    VALUES (%s, %s, %s, %s)
    """
    total = 0
    batch = []

    def flush():
        nonlocal total
        with conn.cursor() as cur:
            cur.executemany(sql, batch)
        conn.commit()
        total += len(batch)
        batch.clear()

    with open(ndjson_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            batch.append((
                d.get("drug_id", ""),
                d.get("interacting_drug_id", ""),
                (d.get("severity") or "unknown")[:20],
                d.get("description") or "",
            ))
            if len(batch) >= batch_size:
                flush()

    if batch:
        flush()
    return total


def import_proteins(conn, ndjson_path: Path, batch_size: int) -> int:
    sql = """
    INSERT INTO proteins
        (id, uniprot_id, entrez_gene_id, organism, name, gene_name)
    VALUES (%s, %s, %s, %s, %s, %s)
    ON DUPLICATE KEY UPDATE
        name=VALUES(name), organism=VALUES(organism)
    """
    total = 0
    batch = []

    def flush():
        nonlocal total
        with conn.cursor() as cur:
            cur.executemany(sql, batch)
        conn.commit()
        total += len(batch)
        batch.clear()

    with open(ndjson_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            batch.append((
                d.get("id"),
                (d.get("uniprot_id") or "")[:20],
                (d.get("entrez_gene_id") or None),
                (d.get("organism") or "")[:200],
                (d.get("name") or "")[:500],
                (d.get("gene_name") or None),
            ))
            if len(batch) >= batch_size:
                flush()

    if batch:
        flush()
    return total


def import_dpi(conn, ndjson_path: Path, batch_size: int) -> int:
    sql = """
    INSERT INTO drug_protein_interactions
        (drug_id, protein_id, uniprot_id, interaction_type, known_action, actions, pubmed_ids)
    VALUES (%s, %s, %s, %s, %s, %s, %s)
    """
    total = 0
    batch = []

    def flush():
        nonlocal total
        with conn.cursor() as cur:
            cur.executemany(sql, batch)
        conn.commit()
        total += len(batch)
        batch.clear()

    with open(ndjson_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            batch.append((
                d.get("drug_id", ""),
                d.get("protein_id"),
                (d.get("uniprot_id") or "")[:20],
                (d.get("interaction_type") or "")[:20],
                (d.get("known_action") or "unknown")[:20],
                j(d.get("actions")),
                j(d.get("pubmed_ids")),
            ))
            if len(batch) >= batch_size:
                flush()

    if batch:
        flush()
    return total


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

@app.command()
def run(
    host:     str = typer.Option("127.0.0.1",                             help="MySQL host"),
    port:     int = typer.Option(3306,                                     help="MySQL port"),
    db:       str = typer.Option("cdss",                                   help="Tên database"),
    user:     str = typer.Option("root",                                   help="MySQL username"),
    password: str = typer.Option("",                                       help="MySQL password"),
    data_dir: str = typer.Option("d:/Du_an/Back_end/Database/data",        help="Thư mục chứa 4 file NDJSON"),
    batch:    int = typer.Option(500,                                      help="Batch size mỗi lần INSERT"),
    reset:   bool = typer.Option(False,                                    help="Xóa dữ liệu cũ trước khi import"),
    only:    str  = typer.Option("",                                       help="Chỉ import table cụ thể: drugs|interactions|proteins|dpi"),
):
    """Import 4 file NDJSON vào MySQL — tạo bảng tự động nếu chưa có."""

    data_path = Path(data_dir)
    files = {
        "drugs":        data_path / "drugs.ndjson",
        "interactions": data_path / "drug_interactions.ndjson",
        "proteins":     data_path / "proteins.ndjson",
        "dpi":          data_path / "drug_protein_interactions.ndjson",
    }

    # Kiểm tra file tồn tại
    missing = [k for k, p in files.items() if not p.exists()]
    if missing:
        typer.echo(f"[LỖI] Không tìm thấy file: {missing}", err=True)
        typer.echo(f"      Kiểm tra --data-dir: {data_path.resolve()}", err=True)
        raise typer.Exit(1)

    typer.echo("=" * 60)
    typer.echo("🔌 Kết nối MySQL...")
    typer.echo(f"   Host    : {host}:{port}")
    typer.echo(f"   Database: {db}")
    typer.echo(f"   User    : {user}")
    typer.echo(f"   Data dir: {data_path.resolve()}")
    typer.echo("=" * 60)

    try:
        conn = connect(host, port, db, user, password)
        typer.echo("✅ Kết nối thành công!\n")
    except Exception as e:
        typer.echo(f"[LỖI] Không kết nối được MySQL: {e}", err=True)
        typer.echo("\nKiểm tra:", err=True)
        typer.echo("  1. MySQL đang chạy chưa?", err=True)
        typer.echo("  2. Đúng host/port/user/password?", err=True)
        typer.echo(f"  3. Database '{db}' đã tạo chưa?", err=True)
        raise typer.Exit(1)

    # --- Tạo bảng ---
    typer.echo("📋 Kiểm tra / tạo bảng...")
    run_ddl(conn, DDL_DRUGS,       "drugs")
    run_ddl(conn, DDL_DRUG_INTERACTIONS, "drug_interactions")
    run_ddl(conn, DDL_PROTEINS,    "proteins")
    run_ddl(conn, DDL_DPI,         "drug_protein_interactions")

    # --- Reset nếu cần ---
    if reset:
        typer.echo("\n⚠️  --reset: Xóa dữ liệu cũ...")
        for t in ["drug_protein_interactions", "drug_interactions", "drugs", "proteins"]:
            if only and only not in t:
                continue
            truncate_table(conn, t)
            typer.echo(f"   🗑  TRUNCATE `{t}`")

    typer.echo("")
    total_start = time.monotonic()

    def should_run(key: str) -> bool:
        return not only or only == key

    # --- Import drugs ---
    if should_run("drugs"):
        typer.echo("📥 [1/4] Import drugs.ndjson...")
        t0 = time.monotonic()
        n = import_drugs(conn, files["drugs"], batch)
        typer.echo(f"   ✅ {n:,} thuốc | {time.monotonic()-t0:.1f}s")

    # --- Import drug_interactions ---
    if should_run("interactions"):
        typer.echo("📥 [2/4] Import drug_interactions.ndjson...")
        t0 = time.monotonic()
        n = import_drug_interactions(conn, files["interactions"], batch)
        typer.echo(f"   ✅ {n:,} tương tác | {time.monotonic()-t0:.1f}s")

    # --- Import proteins ---
    if should_run("proteins"):
        typer.echo("📥 [3/4] Import proteins.ndjson...")
        t0 = time.monotonic()
        n = import_proteins(conn, files["proteins"], batch)
        typer.echo(f"   ✅ {n:,} protein | {time.monotonic()-t0:.1f}s")

    # --- Import drug_protein_interactions ---
    if should_run("dpi"):
        typer.echo("📥 [4/4] Import drug_protein_interactions.ndjson...")
        t0 = time.monotonic()
        n = import_dpi(conn, files["dpi"], batch)
        typer.echo(f"   ✅ {n:,} liên kết drug-protein | {time.monotonic()-t0:.1f}s")

    # --- Tổng kết ---
    conn.close()
    total_elapsed = time.monotonic() - total_start

    typer.echo("\n" + "=" * 60)
    typer.echo("📊 KẾT QUẢ CUỐI CÙNG")
    typer.echo("=" * 60)
    conn2 = connect(host, port, db, user, password)
    for table in ["drugs", "drug_interactions", "proteins", "drug_protein_interactions"]:
        try:
            cnt = count_table(conn2, table)
            typer.echo(f"  {table:<38} {cnt:>10,} rows")
        except Exception:
            pass
    conn2.close()
    typer.echo(f"\n⏱  Tổng thời gian: {total_elapsed:.1f}s")
    typer.echo("=" * 60)
    typer.echo("\n✅ Hoàn thành! Chạy backend:")
    typer.echo('   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000')


if __name__ == "__main__":
    app()
