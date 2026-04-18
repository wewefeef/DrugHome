"""
Pydantic schemas — used for API responses and data validation.

Groups:
  - Drug          : DrugListItem, DrugAutocomplete, DrugDetail, DrugCreate, DrugUpdate
  - Protein       : ProteinBase, ProteinCreate, ProteinUpdate, ProteinOut
  - Interaction   : InteractionBase, InteractionCreate, InteractionUpdate, InteractionOut
  - Analysis      : CheckInteractionsRequest/Response, RiskScoreResult, RecommendationResult
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


# ═══════════════════════════════════════════════════════════════════════════════
# Drug schemas
# ═══════════════════════════════════════════════════════════════════════════════

class DrugListItem(BaseModel):
    """Lightweight schema for drug list / search results."""
    model_config = ConfigDict(from_attributes=True)

    drugbank_id: str
    name: str
    drug_type: Optional[str] = None
    cas_number: Optional[str] = None
    state: Optional[str] = None
    groups: List[Any] = []
    interactions: List[Any] = []
    targets: List[Any] = []
    genomics: List[Any] = []
    toxicity: Optional[str] = None

    @property
    def interaction_count(self) -> int:
        return len(self.interactions)

    @property
    def target_count(self) -> int:
        return len(self.targets)


class DrugAutocomplete(BaseModel):
    """Schema for autocomplete API response."""
    model_config = ConfigDict(from_attributes=True)

    drugbank_id: str
    name: str
    drug_type: Optional[str] = None


class DrugDetail(BaseModel):
    """Full schema for monograph detail page."""
    model_config = ConfigDict(from_attributes=True)

    drugbank_id: str
    name: str
    description: Optional[str] = None
    drug_type: Optional[str] = None
    cas_number: Optional[str] = None
    unii: Optional[str] = None
    state: Optional[str] = None

    indication: Optional[str] = None
    pharmacodynamics: Optional[str] = None
    mechanism_of_action: Optional[str] = None
    toxicity: Optional[str] = None
    metabolism: Optional[str] = None
    absorption: Optional[str] = None
    half_life: Optional[str] = None
    route_of_elimination: Optional[str] = None
    volume_of_distribution: Optional[str] = None
    clearance: Optional[str] = None

    average_mass: Optional[float] = None
    monoisotopic_mass: Optional[float] = None

    genomics: List[Any] = []
    targets: List[Any] = []
    enzymes: List[Any] = []
    transporters: List[Any] = []
    carriers: List[Any] = []
    interactions: List[Any] = []
    food_interactions: List[Any] = []
    smiles: Optional[str] = None

    groups: List[Any] = []
    synonyms: List[Any] = []
    categories: List[Any] = []

    general_references: Dict[str, Any] = {}
    synthesis_reference: Optional[str] = None
    external_identifiers: List[Any] = []
    external_links: List[Any] = []
    products: List[Any] = []
    international_brands: List[Any] = []
    sequences: List[Any] = []

    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class DrugCreate(BaseModel):
    """Schema for creating a new drug via API (POST /api/v1/drugs/)."""
    drug_code: str = Field(..., max_length=10, description="Internal drug code e.g. DR:00001")
    drugbank_id: str = Field(..., max_length=20, description="DrugBank ID e.g. DB00001")
    name: str = Field(..., max_length=500)
    drug_type: Optional[str] = Field(None, max_length=30, description="small molecule | biotech")
    drug_groups: Optional[str] = Field(None, max_length=500, description="Pipe-separated groups e.g. approved|withdrawn")
    atc_codes: Optional[str] = Field(None, max_length=500)
    inchikey: Optional[str] = Field(None, max_length=200)
    cas_number: Optional[str] = Field(None, max_length=50)
    unii: Optional[str] = Field(None, max_length=50)
    state: Optional[str] = Field(None, max_length=20)
    description: Optional[str] = None
    indication: Optional[str] = None
    pharmacodynamics: Optional[str] = None
    mechanism_of_action: Optional[str] = None
    toxicity: Optional[str] = None
    metabolism: Optional[str] = None
    absorption: Optional[str] = None
    half_life: Optional[str] = None
    protein_binding: Optional[str] = None
    route_of_elimination: Optional[str] = None
    categories: Optional[List[Any]] = None
    aliases: Optional[List[str]] = None
    chemical_properties: Optional[Dict[str, Any]] = None
    external_mappings: Optional[Dict[str, Any]] = None


class DrugUpdate(BaseModel):
    """Schema for partial update of a drug (PATCH /api/v1/drugs/{drugbank_id})."""
    name: Optional[str] = Field(None, max_length=500)
    drug_type: Optional[str] = Field(None, max_length=30)
    drug_groups: Optional[str] = Field(None, max_length=500)
    atc_codes: Optional[str] = Field(None, max_length=500)
    inchikey: Optional[str] = Field(None, max_length=200)
    cas_number: Optional[str] = Field(None, max_length=50)
    unii: Optional[str] = Field(None, max_length=50)
    state: Optional[str] = Field(None, max_length=20)
    description: Optional[str] = None
    indication: Optional[str] = None
    pharmacodynamics: Optional[str] = None
    mechanism_of_action: Optional[str] = None
    toxicity: Optional[str] = None
    metabolism: Optional[str] = None
    absorption: Optional[str] = None
    half_life: Optional[str] = None
    protein_binding: Optional[str] = None
    route_of_elimination: Optional[str] = None
    categories: Optional[List[Any]] = None
    aliases: Optional[List[str]] = None
    chemical_properties: Optional[Dict[str, Any]] = None
    external_mappings: Optional[Dict[str, Any]] = None


class DrugOut(BaseModel):
    """Flat response schema for Drug CRUD API."""
    model_config = ConfigDict(from_attributes=True)

    drug_code: str
    drugbank_id: str
    name: str
    drug_type: Optional[str] = None
    atc_codes: Optional[str] = None
    inchikey: Optional[str] = None
    cas_number: Optional[str] = None
    unii: Optional[str] = None
    state: Optional[str] = None
    groups: List[str] = []
    categories: List[str] = []
    aliases: List[str] = []
    description: Optional[str] = None
    indication: Optional[str] = None
    pharmacodynamics: Optional[str] = None
    mechanism_of_action: Optional[str] = None
    toxicity: Optional[str] = None
    absorption: Optional[str] = None
    metabolism: Optional[str] = None
    half_life: Optional[str] = None
    protein_binding: Optional[str] = None
    route_of_elimination: Optional[str] = None
    smiles: Optional[str] = None
    molecular_formula: Optional[str] = None
    average_mass: Optional[float] = None
    target_count: int = 0
    enzyme_count: int = 0
    transporter_count: int = 0


# ═══════════════════════════════════════════════════════════════════════════════
# Protein / Active Substance schemas
# ═══════════════════════════════════════════════════════════════════════════════

class ProteinBase(BaseModel):
    name: str = Field(..., max_length=500)
    uniprot_id: Optional[str] = Field(None, max_length=50)
    entrez_gene_id: Optional[str] = Field(None, max_length=30)
    organism: Optional[str] = Field(None, max_length=200)
    gene_name: Optional[str] = Field(None, max_length=100)
    protein_type: Optional[str] = Field(
        None, max_length=30,
        description="target | enzyme | transporter | carrier"
    )
    general_function: Optional[str] = None
    specific_function: Optional[str] = None


class ProteinCreate(ProteinBase):
    """Schema for POST /api/v1/substances/"""
    pass


class ProteinUpdate(BaseModel):
    """Schema for PATCH /api/v1/substances/{id}"""
    name: Optional[str] = Field(None, max_length=500)
    uniprot_id: Optional[str] = Field(None, max_length=50)
    entrez_gene_id: Optional[str] = Field(None, max_length=30)
    organism: Optional[str] = Field(None, max_length=200)
    gene_name: Optional[str] = Field(None, max_length=100)
    protein_type: Optional[str] = Field(None, max_length=30)
    general_function: Optional[str] = None
    specific_function: Optional[str] = None


class ProteinOut(ProteinBase):
    """Response schema for Protein."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    drug_count: int = 0
    actions: List[str] = []
    created_at: datetime
    updated_at: datetime


# ═══════════════════════════════════════════════════════════════════════════════
# Drug Interaction schemas
# ═══════════════════════════════════════════════════════════════════════════════

class SeverityEnum(str, Enum):
    major = "major"
    moderate = "moderate"
    minor = "minor"
    unknown = "unknown"


class InteractionCreate(BaseModel):
    """Schema for POST /api/v1/interactions/"""
    drug_code: str = Field(..., max_length=20, description="Source drug code (DR:XXXXX)")
    interacting_drug_id: str = Field(..., max_length=20, description="DrugBank ID of the other drug")
    interacting_drug_name: Optional[str] = Field(None, max_length=500)
    severity: Optional[SeverityEnum] = SeverityEnum.unknown
    description: Optional[str] = None


class InteractionUpdate(BaseModel):
    """Schema for PATCH /api/v1/interactions/{id}"""
    interacting_drug_name: Optional[str] = Field(None, max_length=500)
    severity: Optional[SeverityEnum] = None
    description: Optional[str] = None


class InteractionOut(BaseModel):
    """Response schema for DrugInteraction."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    drug_code: str
    drug_drugbank_id: Optional[str] = None
    interacting_drug_id: str
    interacting_drug_name: Optional[str] = None
    severity: Optional[str] = None
    description: Optional[str] = None
    created_at: datetime
    updated_at: datetime


# ═══════════════════════════════════════════════════════════════════════════════
# Analysis Engine schemas
# ═══════════════════════════════════════════════════════════════════════════════

class CheckInteractionsRequest(BaseModel):
    """Input for POST /api/v1/analysis/check-interactions"""
    drug_ids: List[str] = Field(
        ..., min_length=2, max_length=20,
        description="List of DrugBank IDs (DB00001) to check for interactions",
        examples=[["DB00001", "DB00002", "DB00004"]],
    )


class InteractionFound(BaseModel):
    """Single interaction found between two drugs in the request list."""
    drug_a_id: str
    drug_a_name: str
    drug_b_id: str
    drug_b_name: str
    severity: str
    description: str
    source: str = "DrugBank"


class CheckInteractionsResponse(BaseModel):
    """Response for POST /api/v1/analysis/check-interactions"""
    drugs_checked: List[str]
    total_drugs: int
    total_pairs_checked: int
    interactions_found: List[InteractionFound]
    total_interactions: int
    has_major: bool
    has_moderate: bool


class RiskScoreRequest(BaseModel):
    """Input for POST /api/v1/analysis/risk-score"""
    drug_ids: List[str] = Field(
        ..., min_length=2, max_length=20,
        description="List of DrugBank IDs to score",
    )


class SeverityBreakdown(BaseModel):
    major: int = 0
    moderate: int = 0
    minor: int = 0
    unknown: int = 0


class RiskScoreResult(BaseModel):
    """Response for POST /api/v1/analysis/risk-score"""
    drug_ids: List[str]
    score: float = Field(..., ge=0.0, le=10.0, description="Risk score 0–10")
    risk_level: str = Field(..., description="low | moderate | high | critical")
    severity_breakdown: SeverityBreakdown
    shared_enzymes: List[str] = Field(default_factory=list)
    shared_targets: List[str] = Field(default_factory=list)
    total_interactions: int
    explanation: str


class RecommendationRequest(BaseModel):
    """Input for POST /api/v1/analysis/recommendations"""
    drug_ids: List[str] = Field(
        ..., min_length=1, max_length=20,
        description="List of DrugBank IDs in the prescription",
    )
    patient_age: Optional[int] = Field(None, ge=0, le=130)
    patient_weight_kg: Optional[float] = Field(None, ge=0)
    renal_impairment: bool = False
    hepatic_impairment: bool = False
    pregnancy: bool = False


class RecommendationItem(BaseModel):
    """A single recommendation or warning."""
    level: str = Field(..., description="critical | warning | caution | info")
    type: str = Field(..., description="E.g. drug_interaction | renal_risk | hepatic_risk")
    drug_ids_involved: List[str]
    message: str
    action: str = Field(..., description="Suggested action for the prescriber")


class RecommendationResult(BaseModel):
    """Response for POST /api/v1/analysis/recommendations"""
    drug_ids: List[str]
    risk_score: float
    risk_level: str
    recommendations: List[RecommendationItem]
    summary: str
    safe_to_prescribe: bool


# ═══════════════════════════════════════════════════════════════════════════════
# Shared pagination
# ═══════════════════════════════════════════════════════════════════════════════

class PaginatedResponse(BaseModel):
    total: int
    page: int
    per_page: int
    total_pages: int
    items: List[Any]
