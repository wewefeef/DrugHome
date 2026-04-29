"""
SQLAlchemy ORM models — 14 normalized tables.

DrugBank core (12 tables):
  1.  drugs                      ← PK: drugbank_id
  2.  groups                     ← approved / experimental / withdrawn ...
  3.  categories                 ← pharmacological categories + mesh_id
  4.  proteins                   ← targets / enzymes / transporters / carriers
  5.  drug_synonyms              ← alternative names  (1-N from drugs)
  6.  drug_products              ← commercial brand names (1-N from drugs)
  7.  drug_external_identifiers  ← PubChem / ChEMBL cross-refs (1-N from drugs)
  8.  drug_calculated_properties ← logP / Water Solubility / pKa ... (1-N)
  9.  drug_group_map             ← N-N: drugs ↔ groups
  10. drug_category_map          ← N-N: drugs ↔ categories
  11. drug_interactions          ← drug-drug interactions
  12. drug_protein_interactions  ← drug-protein interactions

App-specific (2 tables):
  13. users
  14. analysis_sessions
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, List, Optional

from sqlalchemy import (
    String, Text, Integer, Float, DateTime, ForeignKey,
    UniqueConstraint, Index, func, Numeric,
)
from sqlalchemy.dialects.mysql import JSON, LONGTEXT
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


# ─────────────────────────────────────────────────────────────────────────────
# 1. Drug (central hub — all other DrugBank tables FK back to this)
# ─────────────────────────────────────────────────────────────────────────────

class Drug(Base):
    """Maps to the `drugs` table.  PK = drugbank_id (DB00001 …)."""

    __tablename__ = "drugs"

    # ── Identity ──────────────────────────────────────────────────────────────
    drugbank_id: Mapped[str] = mapped_column(String(20), primary_key=True)
    name: Mapped[str] = mapped_column(String(500), nullable=False, index=True)

    # MySQL column is called "type"
    drug_type: Mapped[Optional[str]] = mapped_column(
        "type", String(30), nullable=True, index=True
    )

    cas_number: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)
    unii: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    atc_codes: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)

    # ── Chemical identity ─────────────────────────────────────────────────────
    inchikey: Mapped[Optional[str]] = mapped_column(String(200), nullable=True, index=True)
    inchi: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    smiles: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    molecular_formula: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    average_mass: Mapped[Optional[float]] = mapped_column(Numeric(12, 4), nullable=True)
    monoisotopic_mass: Mapped[Optional[float]] = mapped_column(Numeric(12, 4), nullable=True)

    # ── Pharmacology ──────────────────────────────────────────────────────────
    description: Mapped[Optional[str]] = mapped_column(LONGTEXT, nullable=True)
    indication: Mapped[Optional[str]] = mapped_column(LONGTEXT, nullable=True)
    pharmacodynamics: Mapped[Optional[str]] = mapped_column(LONGTEXT, nullable=True)
    mechanism_of_action: Mapped[Optional[str]] = mapped_column(LONGTEXT, nullable=True)
    toxicity: Mapped[Optional[str]] = mapped_column(LONGTEXT, nullable=True)
    metabolism: Mapped[Optional[str]] = mapped_column(LONGTEXT, nullable=True)
    absorption: Mapped[Optional[str]] = mapped_column(LONGTEXT, nullable=True)
    half_life: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    protein_binding: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    route_of_elimination: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # ── Timestamps ────────────────────────────────────────────────────────────
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # ── Relationships ─────────────────────────────────────────────────────────
    synonyms_rel: Mapped[List["DrugSynonym"]] = relationship(
        back_populates="drug", cascade="all, delete-orphan", lazy="select"
    )
    products_rel: Mapped[List["DrugProduct"]] = relationship(
        back_populates="drug", cascade="all, delete-orphan", lazy="select"
    )
    external_ids_rel: Mapped[List["DrugExternalIdentifier"]] = relationship(
        back_populates="drug", cascade="all, delete-orphan", lazy="select"
    )
    calc_props_rel: Mapped[List["DrugCalculatedProperty"]] = relationship(
        back_populates="drug", cascade="all, delete-orphan", lazy="select"
    )
    group_maps: Mapped[List["DrugGroupMap"]] = relationship(
        back_populates="drug", cascade="all, delete-orphan", lazy="select"
    )
    category_maps: Mapped[List["DrugCategoryMap"]] = relationship(
        back_populates="drug", cascade="all, delete-orphan", lazy="select"
    )
    drug_interactions_rel: Mapped[List["DrugInteraction"]] = relationship(
        "DrugInteraction",
        foreign_keys="DrugInteraction.drug_id",
        back_populates="drug",
        cascade="all, delete-orphan",
    )
    drug_protein_interactions_rel: Mapped[List["DrugProteinInteraction"]] = relationship(
        "DrugProteinInteraction",
        foreign_keys="DrugProteinInteraction.drug_id",
        back_populates="drug",
        cascade="all, delete-orphan",
    )

    # ── Convenience properties (schema compatibility) ─────────────────────────
    @property
    def groups(self) -> List[str]:
        return [m.group.name for m in self.group_maps if m.group]

    @property
    def categories(self) -> List[str]:
        return [m.category.category for m in self.category_maps if m.category]

    @property
    def synonyms(self) -> List[str]:
        return [s.synonym for s in self.synonyms_rel]

    @property
    def aliases(self) -> List[str]:
        return self.synonyms

    @property
    def external_identifiers(self) -> List[Any]:
        return [
            {"resource": e.resource, "identifier": e.identifier}
            for e in self.external_ids_rel
        ]

    @property
    def products(self) -> List[Any]:
        return list(self.products_rel)

    # Counts populated by API (not stored in DB)
    target_count: int = 0
    enzyme_count: int = 0
    transporter_count: int = 0

    # ── Table-level indexes ───────────────────────────────────────────────────
    __table_args__ = (
        Index("ix_drugs_name_ft", "name", mysql_prefix="FULLTEXT"),
        Index("ix_drugs_type_name", "type", "name"),
        Index("ix_drugs_atc", "atc_codes", mysql_length={"atc_codes": 50}),
    )

    def __repr__(self) -> str:
        return f"<Drug {self.drugbank_id} — {self.name}>"


# ─────────────────────────────────────────────────────────────────────────────
# 2. DrugGroup  (groups table)
# ─────────────────────────────────────────────────────────────────────────────

class DrugGroup(Base):
    """Maps to the `groups` table.  E.g. approved, experimental, withdrawn."""

    __tablename__ = "groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)

    drug_maps: Mapped[List["DrugGroupMap"]] = relationship(back_populates="group")

    def __repr__(self) -> str:
        return f"<DrugGroup {self.name}>"


# ─────────────────────────────────────────────────────────────────────────────
# 3. DrugCategory  (categories table)
# ─────────────────────────────────────────────────────────────────────────────

class DrugCategory(Base):
    """Maps to the `categories` table.  E.g. Analgesics, Antibiotics."""

    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    category: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    mesh_id: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    drug_maps: Mapped[List["DrugCategoryMap"]] = relationship(back_populates="category")

    __table_args__ = (
        Index("ix_categories_name", "category", mysql_length=100),
        Index("ix_categories_mesh", "mesh_id"),
    )

    def __repr__(self) -> str:
        return f"<DrugCategory {self.category}>"


# ─────────────────────────────────────────────────────────────────────────────
# 4. Protein  (proteins table — targets / enzymes / transporters / carriers)
# ─────────────────────────────────────────────────────────────────────────────

class Protein(Base):
    """Maps to the `proteins` table."""

    __tablename__ = "proteins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    uniprot_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, unique=True, index=True)
    entrez_gene_id: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    organism: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    name: Mapped[str] = mapped_column(String(500), nullable=False, index=True)
    gene_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    protein_type: Mapped[Optional[str]] = mapped_column(
        String(30), nullable=True, index=True
    )  # target | enzyme | transporter | carrier
    general_function: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    specific_function: Mapped[Optional[str]] = mapped_column(LONGTEXT, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    drug_protein_interactions: Mapped[List["DrugProteinInteraction"]] = relationship(
        back_populates="protein", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_proteins_name_gene_ft", "name", "gene_name", mysql_prefix="FULLTEXT"),
        Index("ix_proteins_organism", "organism", mysql_length=80),
    )

    def __repr__(self) -> str:
        return f"<Protein {self.uniprot_id} — {self.name}>"


# ─────────────────────────────────────────────────────────────────────────────
# 5. DrugSynonym  (drug_synonyms table — 1-N from drugs)
# ─────────────────────────────────────────────────────────────────────────────

class DrugSynonym(Base):
    """Maps to the `drug_synonyms` table."""

    __tablename__ = "drug_synonyms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    drug_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("drugs.drugbank_id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    synonym: Mapped[str] = mapped_column(String(255), nullable=False)
    language: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    coder: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    drug: Mapped["Drug"] = relationship(back_populates="synonyms_rel")

    __table_args__ = (
        Index("ix_drug_synonyms_synonym", "synonym", mysql_length=100),
    )

    def __repr__(self) -> str:
        return f"<DrugSynonym {self.drug_id}: {self.synonym}>"


# ─────────────────────────────────────────────────────────────────────────────
# 6. DrugProduct  (drug_products table — 1-N from drugs)
# ─────────────────────────────────────────────────────────────────────────────

class DrugProduct(Base):
    """Maps to the `drug_products` table.  Commercial brand names."""

    __tablename__ = "drug_products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    drug_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("drugs.drugbank_id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    labeller: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    ndc_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    dosage_form: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    strength: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    route: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    country: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)
    source: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # FDA | DPD | EMA

    drug: Mapped["Drug"] = relationship(back_populates="products_rel")

    def __repr__(self) -> str:
        return f"<DrugProduct {self.drug_id}: {self.name}>"


# ─────────────────────────────────────────────────────────────────────────────
# 7. DrugExternalIdentifier  (drug_external_identifiers table — 1-N from drugs)
# ─────────────────────────────────────────────────────────────────────────────

class DrugExternalIdentifier(Base):
    """Maps to the `drug_external_identifiers` table.  Cross-refs to PubChem, ChEMBL …"""

    __tablename__ = "drug_external_identifiers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    drug_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("drugs.drugbank_id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    resource: Mapped[str] = mapped_column(String(100), nullable=False)   # PubChem Compound, ChEMBL …
    identifier: Mapped[str] = mapped_column(String(100), nullable=False)

    drug: Mapped["Drug"] = relationship(back_populates="external_ids_rel")

    __table_args__ = (
        UniqueConstraint("drug_id", "resource", name="uq_drug_ext_id"),
        Index("ix_drug_ext_ids_resource_id", "resource", "identifier"),
    )

    def __repr__(self) -> str:
        return f"<DrugExternalIdentifier {self.drug_id}: {self.resource}={self.identifier}>"


# ─────────────────────────────────────────────────────────────────────────────
# 8. DrugCalculatedProperty  (drug_calculated_properties table — 1-N from drugs)
# ─────────────────────────────────────────────────────────────────────────────

class DrugCalculatedProperty(Base):
    """Maps to the `drug_calculated_properties` table.
    Stores one row per property kind (logP, Water Solubility, pKa …)."""

    __tablename__ = "drug_calculated_properties"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    drug_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("drugs.drugbank_id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    kind: Mapped[str] = mapped_column(String(100), nullable=False)    # logP | Water Solubility | pKa …
    value: Mapped[str] = mapped_column(String(200), nullable=False)
    source: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # ChemAxon | ALOGPS …

    drug: Mapped["Drug"] = relationship(back_populates="calc_props_rel")

    __table_args__ = (
        UniqueConstraint("drug_id", "kind", "source", name="uq_drug_calc_prop"),
        Index("ix_drug_calc_props_drug_kind", "drug_id", "kind"),
    )

    def __repr__(self) -> str:
        return f"<DrugCalculatedProperty {self.drug_id}: {self.kind}={self.value}>"


# ─────────────────────────────────────────────────────────────────────────────
# 9. DrugGroupMap  (drug_group_map — N-N: drugs ↔ groups)
# ─────────────────────────────────────────────────────────────────────────────

class DrugGroupMap(Base):
    """Maps to the `drug_group_map` junction table."""

    __tablename__ = "drug_group_map"

    drug_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("drugs.drugbank_id", ondelete="CASCADE"), primary_key=True
    )
    group_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True
    )

    drug: Mapped["Drug"] = relationship(back_populates="group_maps")
    group: Mapped["DrugGroup"] = relationship(back_populates="drug_maps")

    def __repr__(self) -> str:
        return f"<DrugGroupMap {self.drug_id} → group {self.group_id}>"


# ─────────────────────────────────────────────────────────────────────────────
# 10. DrugCategoryMap  (drug_category_map — N-N: drugs ↔ categories)
# ─────────────────────────────────────────────────────────────────────────────

class DrugCategoryMap(Base):
    """Maps to the `drug_category_map` junction table."""

    __tablename__ = "drug_category_map"

    drug_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("drugs.drugbank_id", ondelete="CASCADE"), primary_key=True
    )
    category_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("categories.id", ondelete="CASCADE"), primary_key=True
    )

    drug: Mapped["Drug"] = relationship(back_populates="category_maps")
    category: Mapped["DrugCategory"] = relationship(back_populates="drug_maps")

    def __repr__(self) -> str:
        return f"<DrugCategoryMap {self.drug_id} → category {self.category_id}>"


# ─────────────────────────────────────────────────────────────────────────────
# 11. DrugInteraction  (drug_interactions table)
# ─────────────────────────────────────────────────────────────────────────────

class DrugInteraction(Base):
    """Maps to the `drug_interactions` table.
    One row = one directed drug-drug interaction.
    drug_id       → the source drug (FK to drugs.drugbank_id)
    interacting_drug_id → DrugBank ID of the other drug (may not be in our DB)
    """

    __tablename__ = "drug_interactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    drug_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("drugs.drugbank_id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    interacting_drug_id: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    interacting_drug_name: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    severity: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True, index=True
    )  # major | moderate | minor | unknown
    description: Mapped[Optional[str]] = mapped_column(LONGTEXT, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    drug: Mapped["Drug"] = relationship(
        back_populates="drug_interactions_rel", foreign_keys=[drug_id]
    )

    __table_args__ = (
        UniqueConstraint("drug_id", "interacting_drug_id", name="uq_drug_interaction"),
        Index("ix_di_drug_severity", "drug_id", "severity"),
        Index("ix_di_interacting", "interacting_drug_id"),
        Index("ix_di_both", "drug_id", "interacting_drug_id"),
    )

    def __repr__(self) -> str:
        return f"<DrugInteraction {self.drug_id} ↔ {self.interacting_drug_id} [{self.severity}]>"


# ─────────────────────────────────────────────────────────────────────────────
# 12. DrugProteinInteraction  (drug_protein_interactions table)
# ─────────────────────────────────────────────────────────────────────────────

class DrugProteinInteraction(Base):
    """Maps to the `drug_protein_interactions` table.
    Records how a drug interacts with a protein (target, enzyme, transporter, carrier).
    """

    __tablename__ = "drug_protein_interactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    drug_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("drugs.drugbank_id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    protein_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("proteins.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    uniprot_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)

    interaction_type: Mapped[Optional[str]] = mapped_column(
        String(30), nullable=True, index=True
    )  # target | enzyme | transporter | carrier
    known_action: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    actions: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)    # ["inhibitor", "agonist" …]
    pubmed_ids: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    drug: Mapped["Drug"] = relationship(
        back_populates="drug_protein_interactions_rel", foreign_keys=[drug_id]
    )
    protein: Mapped["Protein"] = relationship(back_populates="drug_protein_interactions")

    __table_args__ = (
        UniqueConstraint(
            "drug_id", "protein_id", "interaction_type",
            name="uq_drug_protein_interaction",
        ),
        Index("ix_dpi_drug_type", "drug_id", "interaction_type"),
        Index("ix_dpi_protein_type", "protein_id", "interaction_type"),
    )

    def __repr__(self) -> str:
        return f"<DrugProteinInteraction {self.drug_id} ↔ protein:{self.protein_id} [{self.interaction_type}]>"


# ─────────────────────────────────────────────────────────────────────────────
# 13. User Account
# ─────────────────────────────────────────────────────────────────────────────

class User(Base):
    """
    Maps to the `users` table.
    Stores registered user accounts with hashed passwords for authentication.
    """
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    avatar_color: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} username={self.username}>"


# ─────────────────────────────────────────────────────────────────────────────
# 14. AnalysisSession
# ─────────────────────────────────────────────────────────────────────────────

class AnalysisSession(Base):
    """
    Maps to the `analysis_sessions` table.
    Stores every drug interaction check a user runs so it can be
    reviewed later from the Analysis page.
    """
    __tablename__ = "analysis_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Owner — nullable so old sessions (before auth) still exist; NULL = orphaned guest session
    user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)

    # Human-readable label (auto-generated or user-named)
    title: Mapped[str] = mapped_column(String(500), nullable=False, default="Untitled Session")

    # Optional tags / category for grouping (pipe-separated, e.g. "Cardiology|ICU")
    tags: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Snapshot of drugs submitted — [{"id": "DB00945", "name": "Aspirin"}, ...]
    drugs_snapshot: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)

    # Full interactions result payload from the check-interactions engine
    interactions_found: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)

    # Derived counters cached so the list view is fast
    total_drugs: Mapped[int] = mapped_column(Integer, default=0)
    total_interactions: Mapped[int] = mapped_column(Integer, default=0)
    major_count: Mapped[int] = mapped_column(Integer, default=0)
    moderate_count: Mapped[int] = mapped_column(Integer, default=0)
    minor_count: Mapped[int] = mapped_column(Integer, default=0)

    # Risk score stored if the caller also ran risk-scoring
    risk_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    risk_level: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    # Free-text clinical notes
    notes: Mapped[Optional[str]] = mapped_column(LONGTEXT, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        # For ordered list view (most recent first)
        Index("ix_session_created", "created_at"),
        # For risk-level filter on dashboard
        Index("ix_session_risk", "risk_level"),
        # Prefix index on title for title search
        Index("ix_session_title", "title", mysql_length=80),
    )

    def __repr__(self) -> str:
        return f"<AnalysisSession id={self.id} drugs={self.total_drugs} interactions={self.total_interactions}>"

