#!/usr/bin/env python3
"""
Fix protein_type in proteins.ndjson and the live MySQL database.
Derives protein_type from drug_protein_interactions (most common interaction_type per protein).
"""
from __future__ import annotations
import json
import os
import sys
from collections import Counter
from pathlib import Path

try:
    import pymysql
    import pymysql.cursors
except ImportError:
    print("[ERROR] pip install pymysql")
    sys.exit(1)

try:
    from dotenv import load_dotenv
    _env = Path(__file__).resolve().parent.parent / ".env"
    if _env.exists():
        load_dotenv(_env)
except ImportError:
    pass

BASE = Path(__file__).resolve().parent.parent
DPI_NDJSON = BASE / "seed_data" / "drug_protein_interactions.ndjson"
PROTEINS_NDJSON = BASE / "seed_data" / "proteins.ndjson"


def build_type_map(dpi_path: Path) -> dict[int, str]:
    """Build {protein_id -> most_common_interaction_type} from DPI ndjson."""
    counters: dict[int, Counter] = {}
    with open(dpi_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            pid = d.get("protein_id")
            itype = (d.get("interaction_type") or "").strip()
            if pid is not None and itype:
                if pid not in counters:
                    counters[pid] = Counter()
                counters[int(pid)][itype] += 1
    return {pid: ctr.most_common(1)[0][0] for pid, ctr in counters.items()}


def fix_ndjson(proteins_path: Path, type_map: dict[int, str]) -> int:
    """Rewrite proteins.ndjson with protein_type filled in."""
    updated = 0
    records = []
    with open(proteins_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            pid = d.get("id")
            if pid is not None and int(pid) in type_map:
                d["protein_type"] = type_map[int(pid)]
                updated += 1
            records.append(d)
    with open(proteins_path, "w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return updated


def fix_database(type_map: dict[int, str]) -> int:
    conn = pymysql.connect(
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
    updated = 0
    BATCH = 500
    items = list(type_map.items())
    try:
        with conn.cursor() as cur:
            for i in range(0, len(items), BATCH):
                batch = items[i:i + BATCH]
                cur.executemany(
                    "UPDATE proteins SET protein_type = %s WHERE id = %s",
                    [(ptype, pid) for pid, ptype in batch],
                )
                updated += cur.rowcount
                conn.commit()
                print(f"   [{i + len(batch):>6,}/{len(items):,}] updated")
    finally:
        conn.close()
    return updated


if __name__ == "__main__":
    print("=== Fix protein_type ===")
    print(f"Reading DPI: {DPI_NDJSON}")
    type_map = build_type_map(DPI_NDJSON)
    print(f"Built type map for {len(type_map)} proteins")

    # Distribution
    dist: Counter = Counter()
    for v in type_map.values():
        dist[v] += 1
    print("Distribution:", dict(dist))

    print(f"\nFixing {PROTEINS_NDJSON.name} ...")
    n = fix_ndjson(PROTEINS_NDJSON, type_map)
    print(f"  Updated {n} records in proteins.ndjson")

    print("\nFixing database ...")
    n_db = fix_database(type_map)
    print(f"  Updated {n_db} rows in proteins table")

    print("\nDone!")
