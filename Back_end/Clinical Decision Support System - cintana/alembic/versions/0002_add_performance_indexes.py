"""Add performance indexes — FULLTEXT + composite indexes for all tables

Revision ID: 0002_add_performance_indexes
Revises: (initial)
Create Date: 2026-04-17

Changes
-------
drugs
  - FULLTEXT ix_drugs_name_ft          (name)
  - COMPOSITE ix_drugs_type_name        (drug_type, name)
  - PREFIX     ix_drugs_groups          (drug_groups[100])
  - PREFIX     ix_drugs_atc             (atc_codes[50])
  - SINGLE     ix_drugs_state           (state)  ← was missing

proteins
  - FULLTEXT ix_proteins_name_gene_ft   (name, gene_name)
  - PREFIX   ix_proteins_organism       (organism[80])

drug_interactions
  - COMPOSITE ix_di_interacting_dbid    (interacting_drug_id, drug_drugbank_id)
  - COMPOSITE ix_di_code_severity       (drug_code, severity)
  - COMPOSITE ix_di_dbid_interacting    (drug_drugbank_id, interacting_drug_id)
  - DROP      ix_di_severity            (replaced by composites above)

drug_protein_interactions
  - COMPOSITE ix_dpi_code_type          (drug_code, interaction_type)
  - COMPOSITE ix_dpi_protein_type       (protein_id, interaction_type)

analysis_sessions
  - SINGLE  ix_session_created          (created_at)
  - SINGLE  ix_session_risk             (risk_level)
  - PREFIX  ix_session_title            (title[80])
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = "0002_perf_indexes"
down_revision = None  # standalone migration — safe to run after create_all
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── drugs ────────────────────────────────────────────────────────────────
    op.create_index(
        "ix_drugs_name_ft", "drugs", ["name"],
        mysql_prefix="FULLTEXT",
    )
    op.create_index(
        "ix_drugs_type_name", "drugs", ["drug_type", "name"],
    )
    op.create_index(
        "ix_drugs_groups", "drugs", ["drug_groups"],
        mysql_length={"drug_groups": 100},
    )
    op.create_index(
        "ix_drugs_atc", "drugs", ["atc_codes"],
        mysql_length={"atc_codes": 50},
    )
    # state column — previously had no index
    op.create_index("ix_drugs_state", "drugs", ["state"])

    # ── proteins ─────────────────────────────────────────────────────────────
    op.create_index(
        "ix_proteins_name_gene_ft", "proteins", ["name", "gene_name"],
        mysql_prefix="FULLTEXT",
    )
    op.create_index(
        "ix_proteins_organism", "proteins", ["organism"],
        mysql_length={"organism": 80},
    )

    # ── drug_interactions ────────────────────────────────────────────────────
    # Drop old single-column severity index (replaced by composites)
    op.drop_index("ix_di_severity", table_name="drug_interactions", if_exists=True)

    op.create_index(
        "ix_di_interacting_dbid", "drug_interactions",
        ["interacting_drug_id", "drug_drugbank_id"],
    )
    op.create_index(
        "ix_di_code_severity", "drug_interactions",
        ["drug_code", "severity"],
    )
    op.create_index(
        "ix_di_dbid_interacting", "drug_interactions",
        ["drug_drugbank_id", "interacting_drug_id"],
    )

    # ── drug_protein_interactions ────────────────────────────────────────────
    op.create_index(
        "ix_dpi_code_type", "drug_protein_interactions",
        ["drug_code", "interaction_type"],
    )
    op.create_index(
        "ix_dpi_protein_type", "drug_protein_interactions",
        ["protein_id", "interaction_type"],
    )

    # ── analysis_sessions ────────────────────────────────────────────────────
    op.create_index("ix_session_created", "analysis_sessions", ["created_at"])
    op.create_index("ix_session_risk", "analysis_sessions", ["risk_level"])
    op.create_index(
        "ix_session_title", "analysis_sessions", ["title"],
        mysql_length={"title": 80},
    )


def downgrade() -> None:
    # analysis_sessions
    op.drop_index("ix_session_title", table_name="analysis_sessions")
    op.drop_index("ix_session_risk", table_name="analysis_sessions")
    op.drop_index("ix_session_created", table_name="analysis_sessions")

    # drug_protein_interactions
    op.drop_index("ix_dpi_protein_type", table_name="drug_protein_interactions")
    op.drop_index("ix_dpi_code_type", table_name="drug_protein_interactions")

    # drug_interactions
    op.drop_index("ix_di_dbid_interacting", table_name="drug_interactions")
    op.drop_index("ix_di_code_severity", table_name="drug_interactions")
    op.drop_index("ix_di_interacting_dbid", table_name="drug_interactions")
    op.create_index("ix_di_severity", "drug_interactions", ["severity"])

    # proteins
    op.drop_index("ix_proteins_organism", table_name="proteins")
    op.drop_index("ix_proteins_name_gene_ft", table_name="proteins")

    # drugs
    op.drop_index("ix_drugs_state", table_name="drugs")
    op.drop_index("ix_drugs_atc", table_name="drugs")
    op.drop_index("ix_drugs_groups", table_name="drugs")
    op.drop_index("ix_drugs_type_name", table_name="drugs")
    op.drop_index("ix_drugs_name_ft", table_name="drugs")
