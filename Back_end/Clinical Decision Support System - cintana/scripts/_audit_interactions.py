"""Audit drug_interactions table for data quality issues."""
from __future__ import annotations
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.database import SessionLocal
from sqlalchemy import text

db = SessionLocal()

# 1. Severity distribution
print("=== SEVERITY DISTRIBUTION ===")
rows = db.execute(text(
    "SELECT severity, COUNT(*) as cnt FROM drug_interactions GROUP BY severity ORDER BY cnt DESC"
)).fetchall()
total = sum(r[1] for r in rows)
for r in rows:
    pct = r[1] / total * 100
    print(f"  {str(r[0]):15s}: {r[1]:>10,}  ({pct:.1f}%)")

# 2. Pairs with mismatched severity
print("\n=== SEVERITY MISMATCH (A->B != B->A) ===")
r = db.execute(text("""
    SELECT COUNT(*) FROM (
        SELECT a.drug_id FROM drug_interactions a
        JOIN drug_interactions b
          ON a.drug_id = b.interacting_drug_id
         AND a.interacting_drug_id = b.drug_id
        WHERE a.drug_id < a.interacting_drug_id
          AND a.severity != b.severity
    ) t
""")).fetchone()
print(f"  Mismatched pairs: {r[0]:,}")

# Sample mismatches
rows = db.execute(text("""
    SELECT a.drug_id, a.interacting_drug_id, a.severity AS sev_a, b.severity AS sev_b,
           d1.name AS name_a, d2.name AS name_b
    FROM drug_interactions a
    JOIN drug_interactions b
      ON a.drug_id = b.interacting_drug_id
     AND a.interacting_drug_id = b.drug_id
    JOIN drugs d1 ON d1.drugbank_id = a.drug_id
    JOIN drugs d2 ON d2.drugbank_id = a.interacting_drug_id
    WHERE a.drug_id < a.interacting_drug_id
      AND a.severity != b.severity
    LIMIT 10
""")).fetchall()
for r in rows:
    print(f"  {r[4]} ({r[0]}) <-> {r[5]} ({r[1]})")
    print(f"    A->B: '{r[2]}'  |  B->A: '{r[3]}'")

# 3. Empty/null severity
print("\n=== EMPTY SEVERITY ===")
r3 = db.execute(text(
    "SELECT COUNT(*) FROM drug_interactions WHERE severity IS NULL OR severity = ''"
)).fetchone()
print(f"  Null/empty severity rows: {r3[0]:,}")

# 4. One-directional rows (no reverse)
print("\n=== ONE-DIRECTIONAL ROWS ===")
r4 = db.execute(text("""
    SELECT COUNT(*) FROM drug_interactions a
    WHERE NOT EXISTS (
        SELECT 1 FROM drug_interactions b
        WHERE b.drug_id = a.interacting_drug_id
          AND b.interacting_drug_id = a.drug_id
    )
""")).fetchone()
print(f"  One-way only (no reverse row): {r4[0]:,}")

# 5. Check known clinical pairs
print("\n=== KNOWN CLINICAL PAIRS ===")
pairs = [
    ("DB00682", "DB01211", "Warfarin + Clarithromycin"),
    ("DB00682", "DB00945", "Warfarin + Aspirin"),
    ("DB00682", "DB01050", "Warfarin + Ibuprofen"),
    ("DB00331", "DB00898", "Metformin + Ethanol"),
    ("DB00316", "DB00945", "Acetaminophen + Aspirin"),
    ("DB00316", "DB00682", "Acetaminophen + Warfarin"),
    ("DB00863", "DB00945", "Ranitidine + Aspirin"),
    ("DB00563", "DB00945", "Methotrexate + Aspirin"),
    ("DB00619", "DB00945", "Imatinib + Aspirin"),
]
for a, b, label in pairs:
    rows = db.execute(text("""
        SELECT drug_id, interacting_drug_id, severity, LEFT(description, 180) AS dsc
        FROM drug_interactions
        WHERE (drug_id = :a AND interacting_drug_id = :b)
           OR (drug_id = :b AND interacting_drug_id = :a)
        LIMIT 2
    """), {"a": a, "b": b}).fetchall()
    if rows:
        sev = rows[0][2]
        print(f"  [{sev:8s}] {label}")
        print(f"           desc: {rows[0][3]}")
    else:
        print(f"  [NOT FOUND] {label}")

db.close()
