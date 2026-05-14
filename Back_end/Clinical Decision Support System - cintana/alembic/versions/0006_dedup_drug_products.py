"""Deduplicate drug_products and add unique constraint

Revision ID: 0006
Revises: 0005_perf_indexes_stored_procs
Create Date: 2026-05-14
"""

from alembic import op
import sqlalchemy as sa

revision = "0006_dedup_drug_products"
down_revision = ("0005_add_is_admin_to_users", "0005_perf_indexes_stored_procs")
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # ── Check if unique index already exists (in case migration ran partially) ──
    idx_exists = conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.STATISTICS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'drug_products' "
        "AND INDEX_NAME = 'uq_drug_products_dedup'"
    )).scalar()

    if not idx_exists:
        # ── Fast dedup: CREATE TABLE with MIN(id) per unique combo, then RENAME ──
        # This is O(n log n) via GROUP BY, vs O(n²) for a self-join DELETE.

        # Clean up leftover temp table from any previous failed run
        conn.execute(sa.text(
            "DROP TABLE IF EXISTS drug_products_dedup_tmp"
        ))

        # Step 1: Create a new table with the same structure
        conn.execute(sa.text(
            "CREATE TABLE drug_products_dedup_tmp LIKE drug_products"
        ))

        # Step 2: Copy only the rows we want to keep (one row per unique combo)
        # Use LEFT(col, 80) to match the prefix lengths used in the UNIQUE index
        conn.execute(sa.text("""
            INSERT INTO drug_products_dedup_tmp
            SELECT * FROM drug_products
            WHERE id IN (
                SELECT MIN(id)
                FROM drug_products
                GROUP BY drug_id, LEFT(name,80), LEFT(labeller,80), LEFT(dosage_form,80), LEFT(strength,80), LEFT(route,80), country, source
            )
        """))

        # Step 3: Atomic swap — rename both tables in one statement
        conn.execute(sa.text(
            "RENAME TABLE drug_products TO drug_products_old_bak, "
            "             drug_products_dedup_tmp TO drug_products"
        ))

        # Step 4: Drop the old data
        conn.execute(sa.text("DROP TABLE drug_products_old_bak"))

        # Step 5: Add unique index to prevent future duplicates
        conn.execute(sa.text("""
            CREATE UNIQUE INDEX uq_drug_products_dedup
            ON drug_products (
                drug_id,
                name(80),
                labeller(80),
                dosage_form(80),
                strength(80),
                route(80),
                country,
                source
            )
        """))


def downgrade() -> None:
    op.execute("DROP INDEX uq_drug_products_dedup ON drug_products")
