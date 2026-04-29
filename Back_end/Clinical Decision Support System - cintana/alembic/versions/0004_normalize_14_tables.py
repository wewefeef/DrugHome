from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql


revision = "0004_normalize_14_tables"
down_revision = "0003_add_user_id_to_sessions"
branch_labels = None
depends_on = None


def upgrade():
    # 1. New lookup tables
    op.create_table(
        "groups",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_groups_name"),
        mysql_engine="InnoDB", mysql_charset="utf8mb4",
    )
    op.create_index("ix_groups_name", "groups", ["name"])

    op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("category", sa.String(500), nullable=False),
        sa.Column("mesh_id", sa.String(20), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("category", name="uq_categories_category"),
        mysql_engine="InnoDB", mysql_charset="utf8mb4",
    )
    op.create_index("ix_categories_name", "categories", ["category"])

    # 2. Add new columns to drugs (before PK change)
    op.add_column("drugs", sa.Column("smiles", sa.Text(), nullable=True))
    op.add_column("drugs", sa.Column("molecular_formula", sa.String(200), nullable=True))
    op.add_column("drugs", sa.Column("average_mass", sa.Numeric(14, 6), nullable=True))
    op.add_column("drugs", sa.Column("monoisotopic_mass", sa.Numeric(14, 6), nullable=True))

    # 3. drug_interactions: drop FK -> add drug_id -> populate -> drop old cols
    op.drop_constraint("fk_di_drug_code", "drug_interactions", type_="foreignkey")

    op.add_column("drug_interactions", sa.Column("drug_id", sa.String(20), nullable=True))
    op.execute(
        "UPDATE drug_interactions SET drug_id = drug_drugbank_id "
        "WHERE drug_drugbank_id IS NOT NULL AND drug_drugbank_id != ''"
    )
    op.execute(
        "UPDATE drug_interactions di "
        "JOIN drugs d ON d.drug_code = di.drug_code "
        "SET di.drug_id = d.drugbank_id "
        "WHERE di.drug_id IS NULL OR di.drug_id = ''"
    )
    op.execute("DELETE FROM drug_interactions WHERE drug_id IS NULL OR drug_id = ''")
    op.alter_column("drug_interactions", "drug_id", existing_type=sa.String(20), nullable=False)
    op.create_foreign_key(
        "fk_di_drug_id", "drug_interactions", "drugs",
        ["drug_id"], ["drugbank_id"], ondelete="CASCADE",
    )

    for idx in [
        "uq_drug_interaction",
        "ix_drug_interactions_drug_code",
        "ix_drug_interactions_drug_drugbank_id",
        "ix_di_code_severity",
        "ix_di_dbid_interacting",
        "ix_di_interacting_dbid",
    ]:
        _drop_index_if_exists("drug_interactions", idx)

    _drop_column_if_exists("drug_interactions", "drug_code")
    _drop_column_if_exists("drug_interactions", "drug_drugbank_id")

    op.create_index("ix_di_drug_severity", "drug_interactions", ["drug_id", "severity"])
    op.create_index("ix_di_interacting", "drug_interactions", ["interacting_drug_id"])
    op.create_index("ix_di_both", "drug_interactions", ["drug_id", "interacting_drug_id"])

    # 4. drug_protein_interactions: same approach
    op.drop_constraint("fk_dpi_drug_code", "drug_protein_interactions", type_="foreignkey")

    op.add_column("drug_protein_interactions", sa.Column("drug_id", sa.String(20), nullable=True))
    op.execute(
        "UPDATE drug_protein_interactions SET drug_id = drug_drugbank_id "
        "WHERE drug_drugbank_id IS NOT NULL AND drug_drugbank_id != ''"
    )
    op.execute(
        "UPDATE drug_protein_interactions dpi "
        "JOIN drugs d ON d.drug_code = dpi.drug_code "
        "SET dpi.drug_id = d.drugbank_id "
        "WHERE dpi.drug_id IS NULL OR dpi.drug_id = ''"
    )
    op.execute("DELETE FROM drug_protein_interactions WHERE drug_id IS NULL OR drug_id = ''")
    op.alter_column("drug_protein_interactions", "drug_id", existing_type=sa.String(20), nullable=False)
    op.create_foreign_key(
        "fk_dpi_drug_id", "drug_protein_interactions", "drugs",
        ["drug_id"], ["drugbank_id"], ondelete="CASCADE",
    )

    for idx in [
        "ix_drug_protein_interactions_drug_code",
        "ix_drug_protein_interactions_drug_drugbank_id",
        "ix_dpi_code_type",
        "ix_dpi_protein_type",
    ]:
        _drop_index_if_exists("drug_protein_interactions", idx)

    _drop_column_if_exists("drug_protein_interactions", "drug_code")
    _drop_column_if_exists("drug_protein_interactions", "drug_drugbank_id")

    op.create_index("ix_dpi_drug_type", "drug_protein_interactions", ["drug_id", "interaction_type"])
    op.create_index("ix_dpi_protein_type", "drug_protein_interactions", ["protein_id", "interaction_type"])

    # 5. drugs: drop old columns and swap PK drug_code -> drugbank_id
    for idx in ["ix_drugs_groups", "ix_drugs_atc", "ix_drugs_type_name",
                "ix_drugs_name_ft", "ix_drugs_type", "ix_drugs_state"]:
        _drop_index_if_exists("drugs", idx)

    op.execute(
        "ALTER TABLE drugs "
        "DROP COLUMN drug_groups, "
        "DROP COLUMN categories, "
        "DROP COLUMN aliases, "
        "DROP COLUMN components, "
        "DROP COLUMN chemical_properties, "
        "DROP COLUMN external_mappings, "
        "DROP PRIMARY KEY, "
        "DROP INDEX ix_drugs_drugbank_id, "
        "DROP COLUMN drug_code, "
        "ADD PRIMARY KEY (drugbank_id)"
    )

    # Re-create dropped indexes on drugs
    op.create_index("ix_drugs_name_ft", "drugs", ["name"], mysql_prefix="FULLTEXT")
    op.create_index("ix_drugs_type", "drugs", ["type"])
    op.create_index("ix_drugs_state", "drugs", ["state"])

    # 6. M2M junction tables
    op.create_table(
        "drug_group_map",
        sa.Column("drug_id", sa.String(20), nullable=False),
        sa.Column("group_id", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("drug_id", "group_id"),
        sa.ForeignKeyConstraint(
            ["drug_id"], ["drugs.drugbank_id"], ondelete="CASCADE", name="fk_dgm_drug"
        ),
        sa.ForeignKeyConstraint(
            ["group_id"], ["groups.id"], ondelete="CASCADE", name="fk_dgm_group"
        ),
        mysql_engine="InnoDB", mysql_charset="utf8mb4",
    )
    op.create_index("ix_dgm_group", "drug_group_map", ["group_id"])

    op.create_table(
        "drug_category_map",
        sa.Column("drug_id", sa.String(20), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("drug_id", "category_id"),
        sa.ForeignKeyConstraint(
            ["drug_id"], ["drugs.drugbank_id"], ondelete="CASCADE", name="fk_dcm_drug"
        ),
        sa.ForeignKeyConstraint(
            ["category_id"], ["categories.id"], ondelete="CASCADE", name="fk_dcm_category"
        ),
        mysql_engine="InnoDB", mysql_charset="utf8mb4",
    )
    op.create_index("ix_dcm_category", "drug_category_map", ["category_id"])

    # 7. Per-drug detail tables
    op.create_table(
        "drug_synonyms",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("drug_id", sa.String(20), nullable=False),
        sa.Column("synonym", sa.String(500), nullable=False),
        sa.Column("language", sa.String(10), nullable=True),
        sa.Column("coder", sa.String(50), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["drug_id"], ["drugs.drugbank_id"], ondelete="CASCADE", name="fk_ds_drug"
        ),
        mysql_engine="InnoDB", mysql_charset="utf8mb4",
    )
    op.create_index("ix_ds_drug", "drug_synonyms", ["drug_id"])

    op.create_table(
        "drug_products",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("drug_id", sa.String(20), nullable=False),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("labeller", sa.String(300), nullable=True),
        sa.Column("ndc_id", sa.String(50), nullable=True),
        sa.Column("dosage_form", sa.String(200), nullable=True),
        sa.Column("strength", sa.String(200), nullable=True),
        sa.Column("route", sa.String(200), nullable=True),
        sa.Column("country", sa.String(100), nullable=True),
        sa.Column("source", sa.String(50), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["drug_id"], ["drugs.drugbank_id"], ondelete="CASCADE", name="fk_dp_drug"
        ),
        mysql_engine="InnoDB", mysql_charset="utf8mb4",
    )
    op.create_index("ix_dp_drug", "drug_products", ["drug_id"])

    op.create_table(
        "drug_external_identifiers",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("drug_id", sa.String(20), nullable=False),
        sa.Column("resource", sa.String(100), nullable=False),
        sa.Column("identifier", sa.String(200), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("drug_id", "resource", name="uq_dei_drug_resource"),
        sa.ForeignKeyConstraint(
            ["drug_id"], ["drugs.drugbank_id"], ondelete="CASCADE", name="fk_dei_drug"
        ),
        mysql_engine="InnoDB", mysql_charset="utf8mb4",
    )
    op.create_index("ix_dei_drug", "drug_external_identifiers", ["drug_id"])
    op.create_index("ix_dei_resource_id", "drug_external_identifiers", ["resource", "identifier"])

    op.create_table(
        "drug_calculated_properties",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("drug_id", sa.String(20), nullable=False),
        sa.Column("kind", sa.String(100), nullable=False),
        sa.Column("value", sa.Text(), nullable=True),
        sa.Column("source", sa.String(50), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("drug_id", "kind", "source", name="uq_dcp_drug_kind_source"),
        sa.ForeignKeyConstraint(
            ["drug_id"], ["drugs.drugbank_id"], ondelete="CASCADE", name="fk_dcp_drug"
        ),
        mysql_engine="InnoDB", mysql_charset="utf8mb4",
    )
    op.create_index("ix_dcp_drug", "drug_calculated_properties", ["drug_id"])


def downgrade():
    op.drop_table("drug_calculated_properties")
    op.drop_table("drug_external_identifiers")
    op.drop_table("drug_products")
    op.drop_table("drug_synonyms")
    op.drop_table("drug_category_map")
    op.drop_table("drug_group_map")
    op.drop_table("categories")
    op.drop_table("groups")


def _drop_index_if_exists(table, index):
    conn = op.get_bind()
    exists = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM information_schema.STATISTICS "
            "WHERE table_schema=DATABASE() AND table_name=:t AND index_name=:i"
        ),
        {"t": table, "i": index},
    ).scalar()
    if exists:
        op.drop_index(index, table_name=table)


def _drop_column_if_exists(table, column):
    conn = op.get_bind()
    exists = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM information_schema.COLUMNS "
            "WHERE table_schema=DATABASE() AND table_name=:t AND column_name=:c"
        ),
        {"t": table, "c": column},
    ).scalar()
    if exists:
        op.drop_column(table, column)
