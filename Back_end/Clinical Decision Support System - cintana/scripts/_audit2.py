"""
Audit drug interactions for data quality.
Run: python -m scripts.audit2
"""
from __future__ import annotations
from app.database import SessionLocal
from sqlalchemy import text

db = SessionLocal()

# --- 1. Severity mismatch using a SAMPLE approach (avoid full self-join) ---
print("=== SEVERITY MISMATCH SAMPLE (500 random pairs) ===")
sample = db.execute(text(
    "SELECT drug_id, interacting_drug_id, severity FROM drug_interactions "
    "WHERE drug_id < interacting_drug_id LIMIT 500"
)).fetchall()

mismatch_count = 0
mismatch_examples = []
for row in sample:
    a, b, sev_ab = row[0], row[1], row[2]
    rev = db.execute(text(
        "SELECT severity FROM drug_interactions "
        "WHERE drug_id = :b AND interacting_drug_id = :a"
    ), {"a": a, "b": b}).fetchone()
    if rev and rev[0] != sev_ab:
        mismatch_count += 1
        if len(mismatch_examples) < 5:
            mismatch_examples.append((a, b, sev_ab, rev[0]))

print(f"  Mismatches in 500 sample: {mismatch_count}")
for ex in mismatch_examples:
    print(f"  {ex[0]} -> {ex[1]}: A->B={ex[2]} | B->A={ex[3]}")

# --- 2. Check engine deduplication for Warfarin + Ibuprofen ---
print("\n=== WARFARIN(DB00682) + IBUPROFEN(DB01050) BOTH DIRECTIONS ===")
rows = db.execute(text(
    "SELECT drug_id, interacting_drug_id, severity, LEFT(description,200) AS dsc "
    "FROM drug_interactions "
    "WHERE (drug_id='DB00682' AND interacting_drug_id='DB01050') "
    "   OR (drug_id='DB01050' AND interacting_drug_id='DB00682')"
)).fetchall()
for r in rows:
    print(f"  {r[0]} -> {r[1]} | severity: {r[2]}")
    print(f"  desc: {r[3]}")

# --- 3. Known high-risk clinical pairs ---
print("\n=== CLINICAL REFERENCE PAIRS ===")
pairs = [
    ("DB00682", "DB01211", "Warfarin + Clarithromycin [expected: MODERATE/MAJOR]"),
    ("DB00682", "DB00945", "Warfarin + Aspirin [expected: MODERATE/MAJOR]"),
    ("DB00682", "DB01050", "Warfarin + Ibuprofen [expected: MAJOR]"),
    ("DB00331", "DB00898", "Metformin + Ethanol [expected: MODERATE]"),
    ("DB00316", "DB00682", "Acetaminophen + Warfarin [expected: MODERATE]"),
    ("DB00563", "DB00945", "Methotrexate + Aspirin [expected: MAJOR]"),
    ("DB01174", "DB00945", "Phenobarbital + Aspirin"),
    ("DB00613", "DB00945", "Amlodipine + Aspirin"),
    ("DB00696", "DB01211", "Ergotamine + Clarithromycin [expected: MAJOR - ergotism]"),
    ("DB00503", "DB00682", "Ritonavir + Warfarin [expected: MODERATE]"),
    ("DB00315", "DB01211", "Zolmitriptan + Clarithromycin"),
    ("DB00641", "DB01211", "Simvastatin + Clarithromycin [expected: MAJOR - rhabdomyolysis]"),
]
for a, b, label in pairs:
    row = db.execute(text(
        "SELECT severity, LEFT(description,150) AS dsc FROM drug_interactions "
        "WHERE drug_id = :a AND interacting_drug_id = :b LIMIT 1"
    ), {"a": a, "b": b}).fetchone()
    if not row:
        # try reverse
        row = db.execute(text(
            "SELECT severity, LEFT(description,150) AS dsc FROM drug_interactions "
            "WHERE drug_id = :b AND interacting_drug_id = :a LIMIT 1"
        ), {"a": a, "b": b}).fetchone()
    if row:
        print(f"  [{row[0]:8s}] {label}")
        print(f"             {row[1]}")
    else:
        print(f"  [NOT FOUND] {label}")

# --- 4. Rows where interacting_drug_name != actual drug name ---
print("\n=== DRUG NAME MISMATCH CHECK (100 sample) ===")
sample2 = db.execute(text(
    "SELECT di.drug_id, di.interacting_drug_id, di.interacting_drug_name, d.name "
    "FROM drug_interactions di "
    "JOIN drugs d ON d.drugbank_id = di.interacting_drug_id "
    "WHERE di.interacting_drug_name IS NOT NULL "
    "  AND di.interacting_drug_name != d.name "
    "LIMIT 10"
)).fetchall()
print(f"  Name mismatches (first 10 found):")
for r in sample2:
    print(f"  {r[0]} -> {r[1]}: stored='{r[2]}' | drugs.name='{r[3]}'")

db.close()
