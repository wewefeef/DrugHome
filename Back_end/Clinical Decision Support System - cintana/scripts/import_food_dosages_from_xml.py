#!/usr/bin/env python3
"""
Import food_interactions + dosages from DrugBank XML
=====================================================
Streams drugbank_full.xml and populates two tables:
  - drug_food_interactions  (food-interaction text per drug)
  - drug_dosages            (dosage form / route / strength per drug)

Usage:
  python -m scripts.import_food_dosages_from_xml
  python -m scripts.import_food_dosages_from_xml --xml "C:/path/to/drugbank_full.xml"
  python -m scripts.import_food_dosages_from_xml --truncate   # clear tables first
  python -m scripts.import_food_dosages_from_xml --only DB00001 --only DB00945
"""

from __future__ import annotations

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
    print("[ERROR] pip install pymysql")
    sys.exit(1)

# Load .env
try:
    from dotenv import load_dotenv
    _env = Path(__file__).resolve().parent.parent / ".env"
    if _env.exists():
        load_dotenv(_env)
except ImportError:
    pass


# ─────────────────────────────────────────────────────────────────────────────
# DB Connection
# ─────────────────────────────────────────────────────────────────────────────

def get_conn() -> pymysql.Connection:
    return pymysql.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=int(os.getenv("DB_PORT", "3306")),
        db=os.getenv("DB_NAME", "cdss"),
        user=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASSWORD", ""),
        charset="utf8mb4",
        autocommit=False,
        cursorclass=pymysql.cursors.Cursor,
        connect_timeout=30,
    )


# ─────────────────────────────────────────────────────────────────────────────
# XML helpers
# ─────────────────────────────────────────────────────────────────────────────

def _detect_namespace(tag: str) -> str:
    if tag.startswith("{"):
        return tag[:tag.index("}") + 1]
    return ""


def _safe_text(elem) -> Optional[str]:
    if elem is None:
        return None
    t = (elem.text or "").strip()
    return t if t else None


# ─────────────────────────────────────────────────────────────────────────────
# Find XML file
# ─────────────────────────────────────────────────────────────────────────────

def find_xml() -> Optional[Path]:
    candidates = [
        Path("C:/cdss/Back_end/Database/drugbank_full.xml"),
        Path("D:/Du_an/Back_end/Database/drugbank_full.xml"),
        Path(__file__).resolve().parent.parent.parent.parent / "Database" / "drugbank_full.xml",
        Path(__file__).resolve().parent.parent.parent / "Database" / "drugbank_full.xml",
    ]
    for c in candidates:
        if c.exists():
            return c
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Main import
# ─────────────────────────────────────────────────────────────────────────────

BATCH = 2000

SQL_FOOD = (
    "INSERT IGNORE INTO drug_food_interactions (drug_id, interaction) "
    "VALUES (%s, %s)"
)
SQL_DOSAGE = (
    "INSERT IGNORE INTO drug_dosages (drug_id, form, route, strength) "
    "VALUES (%s, %s, %s, %s)"
)


def flush(conn, sql: str, rows: list) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(sql, rows)
    conn.commit()
    n = len(rows)
    rows.clear()
    return n


def run_import(
    xml_path: Path,
    truncate: bool = False,
    only_ids: Optional[set] = None,
    skip_food: bool = False,
    skip_dosages: bool = False,
):
    print(f"[INFO] XML: {xml_path}")
    conn = get_conn()

    # Pre-fetch known drugbank_ids
    with conn.cursor() as cur:
        cur.execute("SELECT drugbank_id FROM drugs")
        known_ids: set = {row[0] for row in cur.fetchall()}
    print(f"[INFO] Known drugs in DB: {len(known_ids):,}")

    if truncate:
        with conn.cursor() as cur:
            if not skip_food:
                cur.execute("TRUNCATE TABLE drug_food_interactions")
                print("[INFO] Truncated drug_food_interactions")
            if not skip_dosages:
                cur.execute("TRUNCATE TABLE drug_dosages")
                print("[INFO] Truncated drug_dosages")
        conn.commit()

    food_rows: list = []
    dosage_rows: list = []

    cnt_seen = 0
    cnt_food = cnt_food_total = 0
    cnt_dosage = cnt_dosage_total = 0
    cnt_skip = 0
    start = time.monotonic()

    context = ET.iterparse(str(xml_path), events=("start", "end"))
    ns = ""
    drug_tag = ""

    for event, elem in context:
        if event == "start" and not ns:
            ns = _detect_namespace(elem.tag)
            drug_tag = f"{ns}drug"
            print(f"[INFO] Namespace: '{ns}'")
            continue

        if event != "end" or elem.tag != drug_tag:
            continue

        # Skip stub entries (no type = drug-drug interaction partners, not top-level drugs)
        if not elem.get("type"):
            elem.clear()
            continue

        cnt_seen += 1

        # Get primary DrugBank ID
        db_id = None
        for id_elem in elem.findall(f"{ns}drugbank-id"):
            if (id_elem.get("primary") or "").strip().lower() in {"true", "1", "yes"}:
                db_id = (id_elem.text or "").strip()
                break
        if not db_id:
            id_elems = elem.findall(f"{ns}drugbank-id")
            if id_elems:
                db_id = (id_elems[0].text or "").strip()

        if not db_id or db_id not in known_ids:
            cnt_skip += 1
            elem.clear()
            continue

        if only_ids and db_id not in only_ids:
            elem.clear()
            continue

        # ── Food interactions ───────────────────────────────────────────────
        if not skip_food:
            fi_wrapper = elem.find(f"{ns}food-interactions")
            if fi_wrapper is not None:
                for fi in fi_wrapper.findall(f"{ns}food-interaction"):
                    text = _safe_text(fi)
                    if text:
                        food_rows.append((db_id, text[:2000]))
                        cnt_food += 1

        # ── Dosages ─────────────────────────────────────────────────────────
        if not skip_dosages:
            dosages_wrapper = elem.find(f"{ns}dosages")
            if dosages_wrapper is not None:
                for dos in dosages_wrapper.findall(f"{ns}dosage"):
                    form     = _safe_text(dos.find(f"{ns}form"))
                    route    = _safe_text(dos.find(f"{ns}route"))
                    strength = _safe_text(dos.find(f"{ns}strength"))
                    if form or route or strength:
                        dosage_rows.append((
                            db_id,
                            (form or "")[:200] or None,
                            (route or "")[:200] or None,
                            (strength or "")[:200] or None,
                        ))
                        cnt_dosage += 1

        # Flush batches
        if len(food_rows) >= BATCH:
            cnt_food_total += flush(conn, SQL_FOOD, food_rows)
        if len(dosage_rows) >= BATCH:
            cnt_dosage_total += flush(conn, SQL_DOSAGE, dosage_rows)

        elem.clear()

        if cnt_seen % 1000 == 0:
            elapsed = time.monotonic() - start
            print(f"  [{cnt_seen:>6,}] drugs | food={cnt_food:,} dosages={cnt_dosage:,} | {elapsed:.0f}s")

    # Final flush
    cnt_food_total += flush(conn, SQL_FOOD, food_rows)
    cnt_dosage_total += flush(conn, SQL_DOSAGE, dosage_rows)

    conn.close()
    elapsed = time.monotonic() - start
    print(f"\n[DONE] {elapsed:.1f}s")
    print(f"  Drugs seen      : {cnt_seen:,}")
    print(f"  Skipped         : {cnt_skip:,}")
    print(f"  Food interactions inserted : {cnt_food_total:,}")
    print(f"  Dosages inserted           : {cnt_dosage_total:,}")


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Import food_interactions + dosages from DrugBank XML")
    parser.add_argument("--xml",          type=str,  default=None, help="Path to drugbank_full.xml")
    parser.add_argument("--truncate",     action="store_true",     help="Truncate tables before import")
    parser.add_argument("--only",         type=str,  nargs="*",   help="Only import these DrugBank IDs")
    parser.add_argument("--skip-food",    action="store_true",     help="Skip food_interactions")
    parser.add_argument("--skip-dosages", action="store_true",     help="Skip dosages")
    args = parser.parse_args()

    if args.xml:
        xml_path = Path(args.xml)
    else:
        xml_path = find_xml()
        if not xml_path:
            print("[ERROR] Cannot find drugbank_full.xml. Use --xml <path>")
            sys.exit(1)

    if not xml_path.exists():
        print(f"[ERROR] File not found: {xml_path}")
        sys.exit(1)

    only_ids = set(args.only) if args.only else None

    run_import(
        xml_path=xml_path,
        truncate=args.truncate,
        only_ids=only_ids,
        skip_food=args.skip_food,
        skip_dosages=args.skip_dosages,
    )


if __name__ == "__main__":
    main()
