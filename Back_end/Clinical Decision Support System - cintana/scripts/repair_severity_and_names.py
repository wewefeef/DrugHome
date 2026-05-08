"""
Repair script: Re-classify severity for all drug_interactions rows,
and backfill interacting_drug_name from the drugs table.

Usage:
    python -m scripts.repair_severity_and_names

This script:
1. Runs SQL CASE WHEN to update severity column for all rows.
2. Updates interacting_drug_name via JOIN with drugs table.

Safe to run multiple times (idempotent).
"""

import sys
import os
import time

# Allow running as module or directly
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from sqlalchemy import text


# ─────────────────────────────────────────────────────────────────────────────
# Severity classification SQL.
#
# CASE priority (top = highest priority):
# 1. Explicit keyword: major, severe, fatal, life-threatening, contraindicated
# 2. "risk or severity of" + major condition word (death, respiratory depression, torsades, etc.)
# 3. "risk or severity of" + any other condition → moderate
# 4. Anticoagulant / antiplatelet / sedative activity increase → moderate
# 5. Metabolism/excretion/concentration change → moderate
# 6. Explicit minor keywords: mild, minor, minimal, slight
# 7. QT prolongation, toxicity, specific risks → moderate
# 8. Unknown (no pattern matched)
#
# DrugBank template language means these REGEXP patterns are very reliable.
# ─────────────────────────────────────────────────────────────────────────────
SEVERITY_SQL = """
UPDATE drug_interactions
SET severity = CASE
  -- Explicit major keywords
  WHEN description REGEXP 'major|severe|fatal|life-threatening|contraindicated|critically' THEN 'major'

  -- "risk or severity of" + major consequence
  WHEN description LIKE '%risk or severity of%'
   AND description REGEXP 'death|respiratory depression|torsades|cardiac arrest|anaphyla[xs]|serotonin syndrome|neuroleptic malignant|agranulocyto|aplastic|rhabdomyolysis|liver failure|hepatic failure|intracranial|status epilepticus' THEN 'major'

  -- "risk or severity of" + any outcome = moderate
  WHEN description LIKE '%risk or severity of%' THEN 'moderate'

  -- Activity class modulation (anticoagulant, etc.) = moderate
  WHEN description REGEXP 'anticoagulant activities|antiplatelet activities|hypotensive activities|sedative activities|immunosuppressive activities' THEN 'moderate'

  -- QT / serotonin / specific serious events → moderate
  WHEN description REGEXP 'QT prolongat|QTc prolongat|QT interval|serotonin|hypertensive crisis|torsade' THEN 'moderate'

  -- Metabolism/CYP change → moderate
  WHEN description REGEXP 'metabolism.*decreased|metabolism.*inhibit|metabolism.*increased|metabolism.*induced' THEN 'moderate'
  WHEN description LIKE '%excretion%' AND description REGEXP 'decreased|reduced|increased' THEN 'moderate'

  -- Serum/plasma/blood concentration change → moderate
  WHEN description REGEXP 'serum concentration|plasma concentration|blood concentration'
   AND description REGEXP 'increase|decrease|elevat' THEN 'moderate'

  -- Toxicity related → moderate
  WHEN description REGEXP 'toxic[^o]|toxicity|adverse effect' THEN 'moderate'

  -- Bleeding risk (not already "risk or severity of") → moderate
  WHEN description REGEXP 'bleeding|hemorrhage|bruising' THEN 'moderate'

  -- Hypoglycemia / electrolyte / thyroid → moderate
  WHEN description REGEXP 'hypoglycemi|hypokalaem|hyperkaliaem|hyponatraem|hypernatraem|hypothyroid|hyperthyroid' THEN 'moderate'

  -- Minor keywords
  WHEN description REGEXP 'minor|mild|minimal|slight|small.*effect|weak.*effect' THEN 'minor'

  ELSE 'unknown'
END
WHERE severity = 'unknown';
"""


def repair_severity(db):
    print("Reclassifying severity for all 'unknown' rows (this may take 1-2 min for 2.8M rows)...")
    t0 = time.time()
    result = db.execute(text(SEVERITY_SQL))
    db.commit()
    elapsed = time.time() - t0
    print(f"  Updated {result.rowcount:,} rows in {elapsed:.1f}s")


def repair_interacting_drug_name(db):
    print("\nBackfilling interacting_drug_name from drugs table...")
    t0 = time.time()
    sql = """
    UPDATE drug_interactions di
    JOIN drugs d ON d.drugbank_id = di.interacting_drug_id
    SET di.interacting_drug_name = d.name
    WHERE di.interacting_drug_name IS NULL
    """
    result = db.execute(text(sql))
    db.commit()
    elapsed = time.time() - t0
    print(f"  Updated {result.rowcount:,} rows in {elapsed:.1f}s")


def print_severity_stats(db):
    sql = """
    SELECT severity, COUNT(*) as cnt
    FROM drug_interactions
    GROUP BY severity
    ORDER BY cnt DESC
    """
    rows = db.execute(text(sql)).fetchall()
    total = sum(r.cnt for r in rows)
    print("\nSeverity distribution after repair:")
    for r in rows:
        pct = r.cnt / total * 100
        print(f"  {r.severity:10s}: {r.cnt:>10,}  ({pct:.2f}%)")


def verify_clarithromycin_warfarin(db):
    sql = """
    SELECT di.severity, di.interacting_drug_name, LEFT(di.description, 100) as excerpt
    FROM drug_interactions di
    WHERE di.drug_id = 'DB01211' AND di.interacting_drug_id = 'DB00682'
    LIMIT 1
    """
    row = db.execute(text(sql)).fetchone()
    if row:
        print(f"\nClarithromycin + Warfarin check:")
        print(f"  severity              : {row.severity}")
        print(f"  interacting_drug_name : {row.interacting_drug_name}")
        print(f'  description           : {row.excerpt}...')
    else:
        print("\nClarithromycin + Warfarin: NOT FOUND (check drug IDs)")


if __name__ == "__main__":
    db = SessionLocal()
    try:
        repair_severity(db)
        repair_interacting_drug_name(db)
        print_severity_stats(db)
        verify_clarithromycin_warfarin(db)
    finally:
        db.close()
    print("\nDone.")
