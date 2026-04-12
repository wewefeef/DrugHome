"""
DB Repair Script (v2 â€” fast, no bulk UPDATE)
=============================================
Aligns database schema with the SQLAlchemy ORM models.
No large data migrations â€” just DDL changes.

Run:
    python _repair_db.py
"""

import logging, sys
from pathlib import Path
logging.disable(logging.CRITICAL)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect, text
from app.database import engine

conn = engine.connect()
insp = inspect(engine)


def col_exists(table: str, col: str) -> bool:
    return col in [c["name"] for c in insp.get_columns(table)]


def index_exists(table: str, idx: str) -> bool:
    return idx in [i["name"] for i in insp.get_indexes(table)]


def run(sql: str, label: str = ""):
    try:
        conn.execute(text(sql))
        conn.commit()
        print(f"  âœ“ {label or sql[:80]}")
    except Exception as e:
        conn.rollback()
        msg = str(e)
        if any(x in msg for x in ["Duplicate", "already exists", "Can't DROP"]):
            print(f"  ~ (skip) {label or sql[:60]}")
        else:
            print(f"  âœ— FAILED {label}: {msg[:120]}")


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print("\n=== 1. drug_interactions ===")

# The rename drug_id â†’ drug_code was done by the previous repair run.
# Just check what's there now.

if col_exists("drug_interactions", "updated_at") is False:
    run(
        "ALTER TABLE drug_interactions ADD COLUMN updated_at DATETIME NOT NULL DEFAULT NOW()",
        "add updated_at"
    )

# Fix description type
run("ALTER TABLE drug_interactions MODIFY COLUMN description LONGTEXT", "set description LONGTEXT")

# Drop old indexes (if still present)
for old_idx in ["idx_drug_id", "idx_interacting", "idx_severity"]:
    if index_exists("drug_interactions", old_idx):
        run(f"ALTER TABLE drug_interactions DROP INDEX `{old_idx}`", f"drop {old_idx}")

# Add new indexes
for idx, col in [
    ("ix_drug_interactions_drug_code",          "drug_code"),
    ("ix_drug_interactions_drug_drugbank_id",    "drug_drugbank_id"),
    ("ix_drug_interactions_interacting_drug_id", "interacting_drug_id"),
    ("ix_drug_interactions_severity",            "severity"),
]:
    if not index_exists("drug_interactions", idx):
        run(
            f"CREATE INDEX `{idx}` ON drug_interactions(`{col}`)",
            f"create index {idx}"
        )

# Unique constraint â€” skip if duplicate data exists, it's OK
if not index_exists("drug_interactions", "uq_drug_interaction"):
    run(
        "ALTER TABLE drug_interactions ADD CONSTRAINT uq_drug_interaction "
        "UNIQUE (drug_code, interacting_drug_id)",
        "add unique (drug_code, interacting_drug_id)"
    )

# FK â€” only works if all drug_code values exist in drugs.drug_code
if not index_exists("drug_interactions", "fk_di_drug_code"):
    run(
        """ALTER TABLE drug_interactions
           ADD CONSTRAINT fk_di_drug_code
           FOREIGN KEY (drug_code) REFERENCES drugs(drug_code) ON DELETE CASCADE""",
        "add FK drug_interactions.drug_code â†’ drugs.drug_code"
    )


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print("\n=== 2. drug_protein_interactions ===")

# Rename drug_id â†’ drug_code if not done yet
if col_exists("drug_protein_interactions", "drug_id") and \
   not col_exists("drug_protein_interactions", "drug_code"):
    run(
        "ALTER TABLE drug_protein_interactions RENAME COLUMN drug_id TO drug_code",
        "rename drug_id â†’ drug_code"
    )

for col_def in [
    ("drug_drugbank_id", "VARCHAR(20) NULL AFTER drug_code"),
    ("created_at",       "DATETIME NOT NULL DEFAULT NOW()"),
]:
    if not col_exists("drug_protein_interactions", col_def[0]):
        run(
            f"ALTER TABLE drug_protein_interactions ADD COLUMN {col_def[0]} {col_def[1]}",
            f"add {col_def[0]}"
        )

run("ALTER TABLE drug_protein_interactions MODIFY COLUMN uniprot_id    VARCHAR(50) NULL",  "expand uniprot_id")
run("ALTER TABLE drug_protein_interactions MODIFY COLUMN interaction_type VARCHAR(30) NULL", "expand interaction_type")
run("ALTER TABLE drug_protein_interactions MODIFY COLUMN known_action   VARCHAR(10) NULL",  "shrink known_action")

for old_idx in ["idx_drug", "idx_protein", "idx_type"]:
    if index_exists("drug_protein_interactions", old_idx):
        run(f"ALTER TABLE drug_protein_interactions DROP INDEX `{old_idx}`", f"drop {old_idx}")

for idx, col in [
    ("ix_drug_protein_interactions_drug_code",         "drug_code"),
    ("ix_drug_protein_interactions_drug_drugbank_id",  "drug_drugbank_id"),
    ("ix_drug_protein_interactions_interaction_type",  "interaction_type"),
    ("ix_drug_protein_interactions_protein_id",        "protein_id"),
    ("ix_drug_protein_interactions_uniprot_id",        "uniprot_id"),
]:
    if not index_exists("drug_protein_interactions", idx):
        run(
            f"CREATE INDEX `{idx}` ON drug_protein_interactions(`{col}`)",
            f"create index {idx}"
        )

if not index_exists("drug_protein_interactions", "uq_drug_protein_interaction"):
    run(
        "ALTER TABLE drug_protein_interactions ADD CONSTRAINT uq_drug_protein_interaction "
        "UNIQUE (drug_code, protein_id, interaction_type)",
        "add unique constraint"
    )

for fk_name, local_col, ref_table, ref_col in [
    ("fk_dpi_drug_code",  "drug_code",  "drugs",    "drug_code"),
    ("fk_dpi_protein_id", "protein_id", "proteins", "id"),
]:
    if not index_exists("drug_protein_interactions", fk_name):
        run(
            f"""ALTER TABLE drug_protein_interactions
                ADD CONSTRAINT {fk_name}
                FOREIGN KEY ({local_col}) REFERENCES {ref_table}({ref_col}) ON DELETE CASCADE""",
            f"add FK {fk_name}"
        )


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print("\n=== 3. proteins ===")

for col_name, col_def in [
    ("protein_type",      "VARCHAR(30) NULL"),
    ("general_function",  "TEXT NULL"),
    ("specific_function", "LONGTEXT NULL"),
    ("created_at",        "DATETIME NOT NULL DEFAULT NOW()"),
    ("updated_at",        "DATETIME NOT NULL DEFAULT NOW() ON UPDATE NOW()"),
]:
    if not col_exists("proteins", col_name):
        run(f"ALTER TABLE proteins ADD COLUMN {col_name} {col_def}", f"add {col_name}")

run("ALTER TABLE proteins MODIFY COLUMN uniprot_id VARCHAR(50) NULL", "expand uniprot_id")
run("ALTER TABLE proteins MODIFY COLUMN name VARCHAR(500) NOT NULL", "make name NOT NULL")

for old_idx in ["idx_gene_name", "uq_uniprot"]:
    if index_exists("proteins", old_idx):
        run(f"ALTER TABLE proteins DROP INDEX `{old_idx}`", f"drop {old_idx}")

for idx, col, unique in [
    ("ix_proteins_gene_name",    "gene_name",    False),
    ("ix_proteins_name",         "name",         False),
    ("ix_proteins_protein_type", "protein_type", False),
    ("ix_proteins_uniprot_id",   "uniprot_id",   True),
]:
    if not index_exists("proteins", idx):
        u = "UNIQUE " if unique else ""
        run(f"CREATE {u}INDEX `{idx}` ON proteins(`{col}`)", f"create index {idx}")


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print("\n=== 4. drugs â€” index normalisation ===")

for old_idx in ["idx_name", "idx_type", "uq_drugbank_id"]:
    if index_exists("drugs", old_idx):
        run(f"ALTER TABLE drugs DROP INDEX `{old_idx}`", f"drop {old_idx}")

for idx, col, unique in [
    ("ix_drugs_name",       "name",       False),
    ("ix_drugs_type",       "type",       False),
    ("ix_drugs_cas_number", "cas_number", False),
    ("ix_drugs_drugbank_id","drugbank_id", True),
]:
    if not index_exists("drugs", idx):
        u = "UNIQUE " if unique else ""
        run(f"CREATE {u}INDEX `{idx}` ON drugs(`{col}`)", f"create index {idx}")


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print("\n=== 5. Stamp alembic_version ===")

try:
    conn.execute(text("DELETE FROM alembic_version"))
    conn.execute(text("INSERT INTO alembic_version (version_num) VALUES ('repair_v2')"))
    conn.commit()
    print("  âœ“ stamped version = repair_v2")
except Exception as e:
    conn.rollback()
    print(f"  âœ— stamp failed: {e}")


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print("\n=== Done â€” final schema ===")
insp2 = inspect(engine)
for tname in ["drugs", "proteins", "drug_interactions", "drug_protein_interactions"]:
    cols = [c["name"] for c in insp2.get_columns(tname)]
    print(f"  {tname}: {cols}")

conn.close()
print("\nâœ“ Repair complete.")



# ─────────────────────────────────────────────────────────────────────────────
print("\n=== 4. drugs — index normalisation ===")

for old_idx in ["idx_name", "idx_type", "uq_drugbank_id"]:
    if index_exists("drugs", old_idx):
        run(f"ALTER TABLE drugs DROP INDEX `{old_idx}`", f"drop {old_idx}")

for idx, col, unique in [
    ("ix_drugs_name",        "name",        False),
    ("ix_drugs_type",        "type",        False),
    ("ix_drugs_cas_number",  "cas_number",  False),
    ("ix_drugs_drugbank_id", "drugbank_id", True),
]:
    if not index_exists("drugs", idx):
        u = "UNIQUE " if unique else ""
        run(f"CREATE {u}INDEX `{idx}` ON drugs(`{col}`)", f"create index {idx}")


# ─────────────────────────────────────────────────────────────────────────────
print("\n=== 5. Stamp alembic_version ===")

try:
    conn.execute(text("DELETE FROM alembic_version"))
    conn.execute(text("INSERT INTO alembic_version (version_num) VALUES ('repair_v2')"))
    conn.commit()
    print("  ✓ stamped version = repair_v2")
except Exception as e:
    conn.rollback()
    print(f"  ✗ stamp failed: {e}")


# ─────────────────────────────────────────────────────────────────────────────
print("\n=== Done — final schema ===")
insp2 = inspect(engine)
for tname in ["drugs", "proteins", "drug_interactions", "drug_protein_interactions"]:
    cols = [c["name"] for c in insp2.get_columns(tname)]
    print(f"  {tname}: {cols}")

conn.close()
print("\n✓ Repair complete.")
