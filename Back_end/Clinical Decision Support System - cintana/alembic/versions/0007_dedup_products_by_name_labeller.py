"""Dedup drug_products by (drug_id, name, labeller) — keep one row per brand+manufacturer

Before: unique on (drug_id, name, labeller, dosage_form, strength, route, country, source)
        → Same brand/manufacturer in 25 mg vs 50 mg = 2 separate rows = noisy

After:  unique on (drug_id, name(80), labeller(80))
        → One representative row per brand+manufacturer combo

Revision ID: 0007
Revises: 0006_dedup_drug_products
Create Date: 2026-05-14
"""

from alembic import op
import sqlalchemy as sa

revision = "0007_dedup_products_by_name_labeller"
down_revision = "0006_dedup_drug_products"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # ── Check if the new tighter index already exists ─────────────────────────
    new_idx = conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.STATISTICS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'drug_products' "
        "AND INDEX_NAME = 'uq_dp_drug_name_labeller'"
    )).scalar()

    if new_idx:
        return  # already applied

    # ── Step 1: drop old wide unique index from migration 0006 ────────────────
    old_idx = conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.STATISTICS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'drug_products' "
        "AND INDEX_NAME = 'uq_drug_products_dedup'"
    )).scalar()

    if old_idx:
        conn.execute(sa.text(
            "DROP INDEX uq_drug_products_dedup ON drug_products"
        ))

    # ── Step 2: build deduplicated table keeping MIN(id) per (drug_id, name, labeller)
    conn.execute(sa.text("DROP TABLE IF EXISTS drug_products_tmp2"))

    conn.execute(sa.text(
        "CREATE TABLE drug_products_tmp2 LIKE drug_products"
    ))

    conn.execute(sa.text("""
        INSERT INTO drug_products_tmp2
        SELECT * FROM drug_products
        WHERE id IN (
            SELECT MIN(id)
            FROM drug_products
            GROUP BY drug_id, LEFT(COALESCE(name,''),80), LEFT(COALESCE(labeller,''),80)
        )
    """))

    # ── Step 3: atomic swap ───────────────────────────────────────────────────
    conn.execute(sa.text(
        "RENAME TABLE drug_products TO drug_products_old2, "
        "             drug_products_tmp2 TO drug_products"
    ))
    conn.execute(sa.text("DROP TABLE drug_products_old2"))

    # ── Step 4: add new tighter unique index ──────────────────────────────────
    conn.execute(sa.text("""
        CREATE UNIQUE INDEX uq_dp_drug_name_labeller
        ON drug_products (drug_id, name(80), labeller(80))
    """))


def downgrade() -> None:
    # Restore the old wider unique index (data already deduped, cannot undo rows)
    conn = op.get_bind()
    conn.execute(sa.text("DROP INDEX IF EXISTS uq_dp_drug_name_labeller ON drug_products"))
    conn.execute(sa.text("""
        CREATE UNIQUE INDEX uq_drug_products_dedup
        ON drug_products (
            drug_id, name(80), labeller(80),
            dosage_form(80), strength(80), route(80),
            country, source
        )
    """))
