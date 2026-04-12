"""
SQLAlchemy ORM models — mapped to MySQL tables.
- Drug          → drugs table (from json_to_mysql.py / load_drugbank)
- Protein       → proteins table (active substances / targets)
- DrugInteraction      → drug_interactions table
- DrugProteinInteraction  → drug_protein_interactions table
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, List, Dict, Optional

from sqlalchemy import (
    String, Text, Integer, Float, DateTime, ForeignKey,
    UniqueConstraint, Index, func,
)
from sqlalchemy.dialects.mysql import JSON, LONGTEXT
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Drug(Base):
    """Maps to the `drugs` table in MySQL (created by json_to_mysql.py)."""

    __tablename__ = "drugs"

    # ── Primary Key & Identity ────────────────────────────────────────────────
    drug_code: Mapped[str] = mapped_column(String(10), primary_key=True)
    drugbank_id: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(500), index=True)

    # MySQL column is called "type" — map to drug_type attribute
    drug_type: Mapped[Optional[str]] = mapped_column(
        "type", String(30), nullable=True, index=True
    )

    # Pipe-separated string in MySQL, e.g. "approved|withdrawn"
    _drug_groups_raw: Mapped[Optional[str]] = mapped_column(
        "drug_groups", String(500), nullable=True
    )

    atc_codes: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    inchikey: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    inchi: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cas_number: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)
    unii: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

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

    # ── JSON Columns ──────────────────────────────────────────────────────────
    _categories_json: Mapped[Optional[Any]] = mapped_column("categories", JSON, nullable=True)
    _aliases_json: Mapped[Optional[Any]] = mapped_column("aliases", JSON, nullable=True)
    _chemical_properties_json: Mapped[Optional[Any]] = mapped_column(
        "chemical_properties", JSON, nullable=True
    )
    _external_mappings_json: Mapped[Optional[Any]] = mapped_column(
        "external_mappings", JSON, nullable=True
    )

    # ── Python Properties (compat shims for views/templates) ─────────────────

    @property
    def groups(self) -> List[str]:
        """Returns groups as a list (split from pipe-delimited string)."""
        raw = self._drug_groups_raw or ""
        return [g.strip() for g in raw.split("|") if g.strip()]

    @property
    def synonyms(self) -> List[Any]:
        return list(self._aliases_json or [])

    @property
    def categories(self) -> List[Any]:
        return list(self._categories_json or [])

    @property
    def smiles(self) -> Optional[str]:
        cp = self._chemical_properties_json or {}
        return cp.get("smiles")

    @property
    def average_mass(self) -> Optional[float]:
        cp = self._chemical_properties_json or {}
        try:
            v = cp.get("average_mass")
            return float(v) if v else None
        except (TypeError, ValueError):
            return None

    @property
    def monoisotopic_mass(self) -> Optional[float]:
        return None

    @property
    def volume_of_distribution(self) -> Optional[str]:
        return None

    @property
    def clearance(self) -> Optional[str]:
        return None

    # Fields stored in separate tables — return empty for now
    @property
    def targets(self) -> List[Any]:
        return []

    @property
    def enzymes(self) -> List[Any]:
        return []

    @property
    def transporters(self) -> List[Any]:
        return []

    @property
    def carriers(self) -> List[Any]:
        return []

    @property
    def interactions(self) -> List[Any]:
        return []

    @property
    def food_interactions(self) -> List[Any]:
        return []

    @property
    def genomics(self) -> List[Any]:
        return []

    @property
    def general_references(self) -> Dict[str, Any]:
        return self._external_mappings_json or {}

    @property
    def synthesis_reference(self) -> Optional[str]:
        return None

    @property
    def external_identifiers(self) -> List[Any]:
        ext = self._external_mappings_json or {}
        return [{"resource": k, "identifier": v} for k, v in ext.items()
                if not isinstance(v, (dict, list))]

    @property
    def external_links(self) -> List[Any]:
        return []

    @property
    def products(self) -> List[Any]:
        return []

    @property
    def international_brands(self) -> List[Any]:
        return []

    @property
    def sequences(self) -> List[Any]:
        return []

    @property
    def raw_xml(self) -> Optional[str]:
        return None

    @property
    def created_at(self):
        return None

    @property
    def updated_at(self):
        return None

    # ── Relationships to separate tables ─────────────────────────────────────
    drug_interactions_rel: Mapped[List["DrugInteraction"]] = relationship(
        "DrugInteraction",
        foreign_keys="DrugInteraction.drug_code",
        back_populates="drug",
        cascade="all, delete-orphan",
    )
    drug_protein_interactions_rel: Mapped[List["DrugProteinInteraction"]] = relationship(
        "DrugProteinInteraction",
        foreign_keys="DrugProteinInteraction.drug_code",
        back_populates="drug",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<Drug {self.drugbank_id} — {self.name}>"


# ─────────────────────────────────────────────────────────────────────────────
# Protein / Active Substance
# ─────────────────────────────────────────────────────────────────────────────

class Protein(Base):
    """
    Maps to the `proteins` table.
    Represents a target, enzyme, transporter, or carrier (active substance).
    """
    __tablename__ = "proteins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    uniprot_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, unique=True, index=True)
    entrez_gene_id: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    organism: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    name: Mapped[str] = mapped_column(String(500), index=True)
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

    # Relationships
    drug_protein_interactions: Mapped[List["DrugProteinInteraction"]] = relationship(
        back_populates="protein", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Protein {self.uniprot_id} — {self.name}>"


# ─────────────────────────────────────────────────────────────────────────────
# Drug ↔ Drug Interaction
# ─────────────────────────────────────────────────────────────────────────────

class DrugInteraction(Base):
    """
    Maps to the `drug_interactions` table.
    One row = one directed drug-drug interaction from DrugBank.
    """
    __tablename__ = "drug_interactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Source drug — stored as drug_code (DR:XXXXX) to match ndjson/load scripts
    drug_code: Mapped[str] = mapped_column(
        String(20), ForeignKey("drugs.drug_code", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # Allow drugbank_id references as well (populated during ingestion)
    drug_drugbank_id: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)

    # The other drug in the interaction
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

    # Relationship
    drug: Mapped["Drug"] = relationship(back_populates="drug_interactions_rel", foreign_keys=[drug_code])

    __table_args__ = (
        UniqueConstraint("drug_code", "interacting_drug_id", name="uq_drug_interaction"),
        Index("ix_di_severity", "severity"),
    )

    def __repr__(self) -> str:
        return f"<DrugInteraction {self.drug_code} ↔ {self.interacting_drug_id} [{self.severity}]>"


# ─────────────────────────────────────────────────────────────────────────────
# Drug ↔ Protein Interaction
# ─────────────────────────────────────────────────────────────────────────────

class DrugProteinInteraction(Base):
    """
    Maps to the `drug_protein_interactions` table.
    Records how a drug interacts with a protein (target, enzyme, etc.).
    """
    __tablename__ = "drug_protein_interactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    drug_code: Mapped[str] = mapped_column(
        String(20), ForeignKey("drugs.drug_code", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    drug_drugbank_id: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)

    protein_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("proteins.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    uniprot_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)

    interaction_type: Mapped[Optional[str]] = mapped_column(
        String(30), nullable=True, index=True
    )  # target | enzyme | transporter | carrier
    known_action: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    actions: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)  # ["inhibitor", ...]
    pubmed_ids: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    # Relationships
    drug: Mapped["Drug"] = relationship(back_populates="drug_protein_interactions_rel", foreign_keys=[drug_code])
    protein: Mapped["Protein"] = relationship(back_populates="drug_protein_interactions")

    __table_args__ = (
        UniqueConstraint("drug_code", "protein_id", "interaction_type", name="uq_drug_protein_interaction"),
    )

    def __repr__(self) -> str:
        return f"<DrugProteinInteraction {self.drug_code} ↔ protein:{self.protein_id} [{self.interaction_type}]>"


# ─────────────────────────────────────────────────────────────────────────────
# Analysis Session — persisted interaction check history
# ─────────────────────────────────────────────────────────────────────────────

class AnalysisSession(Base):
    """
    Maps to the `analysis_sessions` table.
    Stores every drug interaction check a user runs so it can be
    reviewed later from the Analysis page.
    """
    __tablename__ = "analysis_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

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

    def __repr__(self) -> str:
        return f"<AnalysisSession id={self.id} drugs={self.total_drugs} interactions={self.total_interactions}>"

