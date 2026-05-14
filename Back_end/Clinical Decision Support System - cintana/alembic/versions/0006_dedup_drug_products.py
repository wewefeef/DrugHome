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

    # ── Step 1: Delete exact duplicates, keep the row with the smallest id ──
    # A duplicate is defined as: same (drug_id, name, labeller, dosage_form,
    # strength, route, country, source) — NULLs treated as equal via <=>
    conn.execute(sa.text("""
        DELETE dp
        FROM drug_products dp
        INNER JOIN (
            SELECT MIN(id) AS keep_id,
                   drug_id, name, labeller, dosage_form, strength, route, country, source
            FROM drug_products
            GROUP BY drug_id, name, labeller, dosage_form, strength, route, country, source
            HAVING COUNT(*) > 1
        ) AS dupes
          ON  dp.drug_id      <=> dupes.drug_id
          AND dp.name         <=> dupes.name
          AND dp.labeller     <=> dupes.labeller
          AND dp.dosage_form  <=> dupes.dosage_form
          AND dp.strength     <=> dupes.strength
          AND dp.route        <=> dupes.route
          AND dp.country      <=> dupes.country
          AND dp.source       <=> dupes.source
          AND dp.id > dupes.keep_id
    """))

    # ── Step 2: Add a unique index (prefix lengths for TEXT/long VARCHAR cols) ──
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
