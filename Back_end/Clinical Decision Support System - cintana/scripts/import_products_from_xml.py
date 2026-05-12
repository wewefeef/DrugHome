#!/usr/bin/env python3
"""
Import drug_products (brand names) directly from DrugBank XML
==============================================================
Script chuyên dụng: chỉ đọc phần <products> từ XML và import vào bảng drug_products.
Không cần re-run toàn bộ pipeline — chạy trực tiếp trên VPS nếu có file XML.

Usage:
  python -m scripts.import_products_from_xml
  python -m scripts.import_products_from_xml --xml "C:/cdss/Database/drugbank_full.xml"
  python -m scripts.import_products_from_xml --xml "D:/Du_an/Back_end/Database/drugbank_full.xml"
  python -m scripts.import_products_from_xml --xml "..." --clear  # xóa hết trước khi import
"""

from __future__ import annotations

import json
import os
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional

try:
    import pymysql
    import pymysql.cursors
except ImportError:
    print("[LỖI] pip install pymysql")
    sys.exit(1)

try:
    import typer
except ImportError:
    print("[LỖI] pip install typer")
    sys.exit(1)

# Load .env if dotenv available
try:
    from dotenv import load_dotenv
    _env = Path(__file__).resolve().parent.parent / ".env"
    if _env.exists():
        load_dotenv(_env)
except ImportError:
    pass

app = typer.Typer(help="Import drug_products (brand names) from DrugBank XML → MySQL")

BATCH_SIZE = 5000

SQL_INSERT = (
    "INSERT IGNORE INTO drug_products "
    "(drug_id, name, labeller, ndc_id, dosage_form, strength, route, country, source) "
    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)"
)


def _st(node) -> Optional[str]:
    """Safe text extract from XML element."""
    if node is None:
        return None
    t = node.text
    return t.strip() if isinstance(t, str) and t.strip() else None


def get_conn() -> pymysql.Connection:
    host     = os.getenv("DB_HOST",     "127.0.0.1")
    port     = int(os.getenv("DB_PORT", "3306"))
    db       = os.getenv("DB_NAME",     "cdss")
    user     = os.getenv("DB_USER",     "root")
    password = os.getenv("DB_PASSWORD", "")
    return pymysql.connect(
        host=host, port=port, db=db, user=user, password=password,
        charset="utf8mb4", autocommit=False,
        cursorclass=pymysql.cursors.Cursor, connect_timeout=30,
    )


def find_xml() -> Optional[Path]:
    """Try common locations for drugbank_full.xml."""
    candidates = [
        Path("C:/cdss/Database/drugbank_full.xml"),
        Path("C:/cdss/backend/Database/drugbank_full.xml"),
        Path("D:/Du_an/Back_end/Database/drugbank_full.xml"),
        Path(__file__).resolve().parent.parent.parent.parent / "Database" / "drugbank_full.xml",
    ]
    for c in candidates:
        if c.exists():
            return c
    return None


@app.command()
def main(
    xml: Optional[str] = typer.Option(None, "--xml", help="Path to drugbank_full.xml"),
    clear: bool = typer.Option(False, "--clear", help="Clear drug_products table before import"),
    progress: int = typer.Option(500, "--progress", help="Log every N drugs (0=off)"),
):
    """Stream DrugBank XML and import all <products> entries into drug_products table."""

    # ── Locate XML ────────────────────────────────────────────────────────────
    xml_path = Path(xml) if xml else find_xml()
    if xml_path is None or not xml_path.exists():
        typer.echo("[LỖI] Không tìm thấy drugbank_full.xml. Dùng --xml để chỉ định path.", err=True)
        raise typer.Exit(1)

    typer.echo(f"📄 XML: {xml_path}  ({xml_path.stat().st_size / 1024 / 1024:.0f} MB)")

    # ── Connect DB ────────────────────────────────────────────────────────────
    try:
        conn = get_conn()
        typer.echo("✅ Kết nối MySQL thành công")
    except Exception as e:
        typer.echo(f"[LỖI] Kết nối DB thất bại: {e}", err=True)
        raise typer.Exit(1)

    # ── Load known drug IDs ───────────────────────────────────────────────────
    typer.echo("📋 Đang load danh sách drugbank_id từ DB...")
    with conn.cursor() as cur:
        cur.execute("SELECT drugbank_id FROM drugs")
        known_ids = frozenset(r[0] for r in cur.fetchall())
    typer.echo(f"   Found {len(known_ids):,} drugs in DB")

    if clear:
        typer.echo("🗑️  Xóa drug_products cũ...")
        with conn.cursor() as cur:
            cur.execute("DELETE FROM drug_products")
        conn.commit()
        typer.echo("   Cleared.")

    # ── Stream XML ────────────────────────────────────────────────────────────
    typer.echo("\n⏳ Đang parse XML (streaming)...")
    start = time.monotonic()

    ns = ""
    cnt_drugs = 0
    cnt_products = 0
    rows: list = []

    def flush():
        nonlocal rows
        if not rows:
            return
        with conn.cursor() as cur:
            cur.executemany(SQL_INSERT, rows)
        conn.commit()
        rows = []

    for event, elem in ET.iterparse(str(xml_path), events=("start", "end")):
        # Detect namespace from root tag
        if event == "start" and ns == "" and elem.tag.startswith("{"):
            ns = elem.tag.split("}")[0] + "}"
            continue

        if event != "end":
            continue

        if elem.tag != f"{ns}drug":
            continue

        # Get primary DrugBank ID
        dbid = None
        for di in elem.findall(f"{ns}drugbank-id"):
            if di.get("primary") == "true":
                dbid = (di.text or "").strip()
                break
        if not dbid:
            dilist = elem.findall(f"{ns}drugbank-id")
            if dilist:
                dbid = (dilist[0].text or "").strip()
        if not dbid or dbid not in known_ids:
            elem.clear()
            continue

        cnt_drugs += 1

        # Extract products
        products_node = elem.find(f"{ns}products")
        if products_node is not None:
            for p in products_node.findall(f"{ns}product"):
                pname = _st(p.find(f"{ns}name"))
                if not pname:
                    continue
                rows.append((
                    dbid,
                    pname[:255],
                    (_st(p.find(f"{ns}labeller")) or "")[:255] or None,
                    (_st(p.find(f"{ns}ndc-id")) or "")[:50] or None,
                    (_st(p.find(f"{ns}dosage-form")) or "")[:255] or None,
                    (_st(p.find(f"{ns}strength")) or "")[:100] or None,
                    (_st(p.find(f"{ns}route")) or "")[:100] or None,
                    (_st(p.find(f"{ns}country")) or "")[:50] or None,
                    (_st(p.find(f"{ns}source")) or "")[:50] or None,
                ))
                cnt_products += 1

        if len(rows) >= BATCH_SIZE:
            flush()

        if progress > 0 and cnt_drugs % progress == 0:
            elapsed = time.monotonic() - start
            typer.echo(
                f"   [{cnt_drugs:>6,}] drugs | products={cnt_products:,} | {elapsed:.0f}s"
            )

        elem.clear()

    flush()

    elapsed = time.monotonic() - start
    typer.echo("\n" + "─" * 65)
    typer.echo(f"✅ Hoàn thành trong {elapsed:.1f}s")
    typer.echo(f"   Drugs processed : {cnt_drugs:,}")
    typer.echo(f"   Products imported: {cnt_products:,}")

    # Final count
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM drug_products")
        total = cur.fetchone()[0]
    typer.echo(f"   drug_products table total: {total:,}")
    conn.close()


if __name__ == "__main__":
    app()
