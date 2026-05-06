#!/usr/bin/env python3
"""
Seed normalized MySQL schema from NDJSON files.
================================================
Dùng khi VPS đã chạy alembic (tables tồn tại nhưng rỗng).
Script này INSERT dữ liệu cơ bản vào:
  - drugs            (từ Database/data/drugs.ndjson)
  - proteins         (từ seed_data/proteins.ndjson)
  - drug_protein_interactions (từ seed_data/drug_protein_interactions.ndjson)

Sau khi chạy script này, tiếp tục chạy:
  python -m scripts.import_normalized_data
để cập nhật đầy đủ pharmacology data + groups/categories/synonyms/interactions.

Usage (từ thư mục project root):
  cd "C:\\cdss\\Back_end\\Clinical Decision Support System - cintana"
  venv\\Scripts\\python.exe -m scripts.seed_normalized
  venv\\Scripts\\python.exe -m scripts.seed_normalized --data-dir "C:\\cdss\\Back_end\\Database\\data"
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

try:
    import pymysql
    import pymysql.cursors
except ImportError:
    print("[ERROR] pip install pymysql")
    sys.exit(1)

try:
    import typer
except ImportError:
    print("[ERROR] pip install typer")
    sys.exit(1)

# Load .env if available
try:
    from dotenv import load_dotenv
    _env = Path(__file__).resolve().parent.parent / ".env"
    if _env.exists():
        load_dotenv(_env)
except ImportError:
    pass

app = typer.Typer(help="Seed normalized CDSS schema from NDJSON files")

BATCH_SIZE = 500


def get_conn() -> pymysql.Connection:
    return pymysql.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=int(os.getenv("DB_PORT", "3306")),
        db=os.getenv("DB_NAME", "cdss"),
        user=os.getenv("DB_USER", "cdss_user"),
        password=os.getenv("DB_PASSWORD", "CdssApp@2026!"),
        charset="utf8mb4",
        autocommit=False,
        cursorclass=pymysql.cursors.Cursor,
        connect_timeout=30,
    )


def flush_batch(conn, sql: str, rows: list) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(sql, rows)
    conn.commit()
    n = len(rows)
    rows.clear()
    return n


def count_table(conn, table: str) -> int:
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) FROM `{table}`")
        return cur.fetchone()[0]


# ─────────────────────────────────────────────────────────────────────────────
# Step 1: Seed drugs table
# ─────────────────────────────────────────────────────────────────────────────

def seed_drugs(conn, drugs_ndjson: Path) -> dict[str, str]:
    """
    INSERT basic drug rows into normalized drugs table.
    Returns code_map: {drug_code -> drugbank_id} for DPI remapping.
    """
    typer.echo("\n── Step 1: Seeding drugs ──")
    typer.echo(f"   Reading: {drugs_ndjson}")

    sql = """
        INSERT IGNORE INTO drugs
            (drugbank_id, name, type, cas_number, unii, atc_codes, state)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
    """

    rows: list = []
    code_map: dict[str, str] = {}
    total = 0
    start = time.monotonic()

    with open(drugs_ndjson, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            dbid = (d.get("drugbank_id") or "").strip()
            code = (d.get("drug_code") or "").strip()
            if not dbid:
                continue
            if code:
                code_map[code] = dbid

            rows.append((
                dbid,
                (d.get("name") or "")[:500],
                (d.get("type") or "")[:30],
                (d.get("cas_number") or "")[:50],
                (d.get("unii") or "")[:50],
                (d.get("atc_codes") or "")[:500],
                (d.get("state") or "")[:20],
            ))

            if len(rows) >= BATCH_SIZE:
                total += flush_batch(conn, sql, rows)
                if total % 5000 == 0:
                    typer.echo(f"   [{total:>6,}] drugs inserted | {time.monotonic()-start:.0f}s")

    total += flush_batch(conn, sql, rows)
    typer.echo(f"   ✅ Inserted {total:,} drugs in {time.monotonic()-start:.1f}s")
    typer.echo(f"   Built drug_code map: {len(code_map):,} entries")
    return code_map


# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Seed proteins table
# ─────────────────────────────────────────────────────────────────────────────

def seed_proteins(conn, proteins_ndjson: Path):
    """
    INSERT proteins with explicit integer IDs so DPI protein_id references remain valid.
    """
    typer.echo("\n── Step 2: Seeding proteins ──")
    typer.echo(f"   Reading: {proteins_ndjson}")

    sql = """
        INSERT IGNORE INTO proteins
            (id, uniprot_id, entrez_gene_id, name, gene_name, protein_type, organism)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
    """

    rows: list = []
    total = 0
    start = time.monotonic()

    with open(proteins_ndjson, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            pid = d.get("id")
            if pid is None:
                continue

            rows.append((
                int(pid),
                (d.get("uniprot_id") or "")[:50],
                (d.get("entrez_gene_id") or None),
                (d.get("name") or "")[:500],
                (d.get("gene_name") or None),
                (d.get("protein_type") or None),
                (d.get("organism") or "")[:200],
            ))

            if len(rows) >= BATCH_SIZE:
                total += flush_batch(conn, sql, rows)

    total += flush_batch(conn, sql, rows)
    typer.echo(f"   ✅ Inserted {total:,} proteins in {time.monotonic()-start:.1f}s")


# ─────────────────────────────────────────────────────────────────────────────
# Step 3: Seed drug_protein_interactions
# ─────────────────────────────────────────────────────────────────────────────

def seed_dpi(conn, dpi_ndjson: Path, code_map: dict[str, str]):
    """
    INSERT drug_protein_interactions mapping drug_code -> drugbank_id via code_map.
    """
    typer.echo("\n── Step 3: Seeding drug_protein_interactions ──")
    typer.echo(f"   Reading: {dpi_ndjson}")

    # Build protein map: protein_id (int) already in DB
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM proteins")
        valid_proteins: set[int] = {row[0] for row in cur.fetchall()}
    typer.echo(f"   Valid protein IDs: {len(valid_proteins):,}")

    # Valid drug IDs
    with conn.cursor() as cur:
        cur.execute("SELECT drugbank_id FROM drugs")
        valid_drugs: set[str] = {row[0] for row in cur.fetchall()}
    typer.echo(f"   Valid drug IDs: {len(valid_drugs):,}")

    sql = """
        INSERT IGNORE INTO drug_protein_interactions
            (drug_id, protein_id, uniprot_id, interaction_type, known_action, actions, pubmed_ids)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
    """

    rows: list = []
    total = 0
    skip_drug = 0
    skip_protein = 0
    start = time.monotonic()

    with open(dpi_ndjson, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)

            # Map drug_code → drugbank_id
            raw_drug_id = (d.get("drug_id") or "").strip()
            # drug_id from NDJSON could be DR:XXXXX (drug_code) or DB00001 (drugbank_id)
            if raw_drug_id.startswith("DB"):
                dbid = raw_drug_id
            else:
                dbid = code_map.get(raw_drug_id, "")

            if not dbid or dbid not in valid_drugs:
                skip_drug += 1
                continue

            protein_id = d.get("protein_id")
            if protein_id is None or int(protein_id) not in valid_proteins:
                skip_protein += 1
                continue

            # Serialize actions/pubmed_ids (JSON list → pipe-separated string)
            actions = d.get("actions")
            if isinstance(actions, list):
                actions_str = "|".join(str(a) for a in actions)[:500]
            elif isinstance(actions, str):
                actions_str = actions[:500]
            else:
                actions_str = None

            pubmed_ids = d.get("pubmed_ids")
            if isinstance(pubmed_ids, list):
                pubmed_str = "|".join(str(p) for p in pubmed_ids)[:500]
            elif isinstance(pubmed_ids, str):
                pubmed_str = pubmed_ids[:500]
            else:
                pubmed_str = None

            rows.append((
                dbid,
                int(protein_id),
                (d.get("uniprot_id") or "")[:50],
                (d.get("interaction_type") or "")[:30],
                (d.get("known_action") or "unknown")[:10],
                actions_str,
                pubmed_str,
            ))

            if len(rows) >= BATCH_SIZE:
                total += flush_batch(conn, sql, rows)
                if total % 10000 == 0:
                    typer.echo(f"   [{total:>7,}] DPI rows | {time.monotonic()-start:.0f}s")

    total += flush_batch(conn, sql, rows)
    typer.echo(f"   ✅ Inserted {total:,} DPI rows in {time.monotonic()-start:.1f}s")
    typer.echo(f"   Skipped (drug not found) : {skip_drug:,}")
    typer.echo(f"   Skipped (protein not found): {skip_protein:,}")


# ─────────────────────────────────────────────────────────────────────────────
# Main CLI command
# ─────────────────────────────────────────────────────────────────────────────

@app.command()
def main(
    data_dir: str = typer.Option(
        "",
        "--data-dir", "-d",
        help="Path to NDJSON data directory (contains drugs.ndjson, drug_interactions.ndjson).",
    ),
    skip_proteins: bool = typer.Option(False, "--skip-proteins", help="Skip seeding proteins."),
    skip_dpi: bool = typer.Option(False, "--skip-dpi", help="Skip seeding drug_protein_interactions."),
):
    """Seed normalized CDSS MySQL schema from NDJSON files."""

    # ── Resolve data directory ────────────────────────────────────────────────
    if data_dir:
        data_path = Path(data_dir)
    else:
        candidates = [
            Path(__file__).resolve().parent.parent.parent / "Database" / "data",
            Path(__file__).resolve().parent.parent.parent.parent / "Database" / "data",
            Path("C:/cdss/Back_end/Database/data"),
            Path("d:/Du_an/Back_end/Database/data"),
        ]
        data_path = None
        for c in candidates:
            if (c / "drugs.ndjson").exists():
                data_path = c
                break
        if not data_path:
            typer.echo("[ERROR] Cannot find drugs.ndjson. Use --data-dir to specify.", err=True)
            raise typer.Exit(1)

    seed_dir = Path(__file__).resolve().parent.parent / "seed_data"

    typer.echo("=" * 65)
    typer.echo("🌱 CDSS Normalized Schema Seeder")
    typer.echo("=" * 65)
    typer.echo(f"📁 Data dir  : {data_path}")
    typer.echo(f"📁 Seed dir  : {seed_dir}")
    typer.echo(f"📄 drugs.ndjson      : {'✅' if (data_path / 'drugs.ndjson').exists() else '❌'}")
    typer.echo(f"📄 proteins.ndjson   : {'✅' if (seed_dir / 'proteins.ndjson').exists() else '❌'}")
    typer.echo(f"📄 dpi.ndjson        : {'✅' if (seed_dir / 'drug_protein_interactions.ndjson').exists() else '❌'}")
    typer.echo("─" * 65)

    # ── Connect ───────────────────────────────────────────────────────────────
    try:
        conn = get_conn()
        typer.echo("✅ Connected to MySQL")
    except Exception as e:
        typer.echo(f"[ERROR] DB connection failed: {e}", err=True)
        raise typer.Exit(1)

    # ── Show current counts ───────────────────────────────────────────────────
    typer.echo("\n── Current row counts ──")
    for t in ["drugs", "proteins", "drug_protein_interactions", "drug_interactions"]:
        try:
            n = count_table(conn, t)
            typer.echo(f"   {t:<35} {n:>10,}")
        except Exception:
            typer.echo(f"   {t:<35} (table not found)")

    # ── Step 1: Drugs ─────────────────────────────────────────────────────────
    drugs_ndjson = data_path / "drugs.ndjson"
    if not drugs_ndjson.exists():
        typer.echo(f"[ERROR] Not found: {drugs_ndjson}", err=True)
        raise typer.Exit(1)

    code_map = seed_drugs(conn, drugs_ndjson)

    # ── Step 2: Proteins ──────────────────────────────────────────────────────
    proteins_ndjson = seed_dir / "proteins.ndjson"
    if not skip_proteins and proteins_ndjson.exists():
        seed_proteins(conn, proteins_ndjson)
    elif not proteins_ndjson.exists():
        typer.echo("\n⚠️  proteins.ndjson not found in seed_data/ — skipping")

    # ── Step 3: DPI ───────────────────────────────────────────────────────────
    dpi_ndjson = seed_dir / "drug_protein_interactions.ndjson"
    if not skip_dpi and dpi_ndjson.exists():
        seed_dpi(conn, dpi_ndjson, code_map)
    elif not dpi_ndjson.exists():
        typer.echo("\n⚠️  drug_protein_interactions.ndjson not found in seed_data/ — skipping")

    # ── Final counts ──────────────────────────────────────────────────────────
    typer.echo("\n── Final row counts ──")
    for t in ["drugs", "proteins", "drug_protein_interactions"]:
        try:
            n = count_table(conn, t)
            typer.echo(f"   {t:<35} {n:>10,}")
        except Exception:
            typer.echo(f"   {t:<35} (error)")

    typer.echo("\n✅ Seed complete!")
    typer.echo("\n👉 Tiếp theo chạy:")
    typer.echo("   python -m scripts.import_normalized_data")
    typer.echo("   (để import đầy đủ: pharmacology, groups, categories, synonyms, drug_interactions)")


if __name__ == "__main__":
    app()
