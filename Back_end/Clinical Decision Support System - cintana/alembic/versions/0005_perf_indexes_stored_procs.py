"""Performance optimizations: covering indexes + stored procedures

Revision ID: 0005_perf_indexes_stored_procs
Revises: 0004_normalize_14_tables
Create Date: 2026-05-07

Changes
-------
Indexes (new):
  drug_category_map
    ix_dcm_cat_drug  (category_id, drug_id)   ← reverse lookup: category → drugs
      Before: PK was only (drug_id, category_id) — query had to scan all
              drug_category_map rows filtered by category LIKE '%kw%' join
      After:  lookup by category_id IN (...) hits this covering index directly

  drug_interactions
    ix_di_rev_cover  (interacting_drug_id, drug_id, severity)
      Covers bidirectional query WHERE interacting_drug_id = X (reverse direction)
      Existing ix_di_both(drug_id, interacting_drug_id) covers forward direction

Stored Procedures (created at startup via main.py; listed here for reference):
  sp_category_drugs_net(p_cat_ids TEXT, p_limit INT)
    — Drugs that belong to given categories AND have protein network data,
      with target/enzyme/transporter counts in a single server-side query.

  sp_check_interactions_multi(p_drug_ids TEXT)
    — Bidirectional interaction check for multiple drugs in one round-trip.

  sp_protein_counts_batch(p_drug_ids TEXT)
    — Protein-type counts for a batch of drugs (GROUP BY drug_id, type).
"""
from __future__ import annotations

from alembic import op


revision = "0005_perf_indexes_stored_procs"
down_revision = "0004_normalize_14_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── drug_category_map ────────────────────────────────────────────────────
    # PK is (drug_id, category_id) — fast when you know the drug.
    # New index is (category_id, drug_id) — fast when you know the categories.
    op.create_index(
        "ix_dcm_cat_drug", "drug_category_map",
        ["category_id", "drug_id"],
    )

    # ── drug_interactions: reverse covering index ─────────────────────────────
    # When we look up all interactions WHERE interacting_drug_id IN (...),
    # MySQL now can do an index range scan instead of a full table scan.
    op.create_index(
        "ix_di_rev_cover", "drug_interactions",
        ["interacting_drug_id", "drug_id", "severity"],
    )


def downgrade() -> None:
    op.drop_index("ix_di_rev_cover", table_name="drug_interactions")
    op.drop_index("ix_dcm_cat_drug", table_name="drug_category_map")
