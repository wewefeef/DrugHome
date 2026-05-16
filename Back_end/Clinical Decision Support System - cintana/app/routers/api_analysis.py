"""
Clinical Analysis API
======================
Endpoints that power the three core CDSS engines:

  POST /api/v1/analysis/check-interactions  → Interaction Analysis Engine
  POST /api/v1/analysis/risk-score          → Risk Scoring Engine
  POST /api/v1/analysis/recommendations     → Recommendation Engine
  GET  /api/v1/stats                        → Live database statistics

All endpoints accept JSON bodies and return structured JSON.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func as sqlfunc, text as sqtext
from sqlalchemy.orm import Session, load_only
from typing import Optional

from app.core.interaction_engine import check_interactions
from app.core.recommendation_engine import generate_recommendations
from app.core.risk_engine import compute_risk_score
from app.core.simple_cache import cache_get, cache_set
from app.database import get_db
from app.models import Drug, DrugInteraction, DrugProteinInteraction, Protein, SystemMetadata
from app.schemas import (
    CheckInteractionsRequest,
    CheckInteractionsResponse,
    RecommendationRequest,
    RecommendationResult,
    RiskScoreRequest,
    RiskScoreResult,
)

router = APIRouter(prefix="/api/v1/analysis", tags=["Clinical Analysis"])

# ── Stats router (prefix /api/v1) — registered separately in main.py ─────────
stats_router = APIRouter(prefix="/api/v1", tags=["Statistics"])


def _validate_drug_ids(db: Session, drug_ids: list[str]) -> None:
    """Raise 422 if any drug_id is not found. Uses ix_drugs_drugbank_id index + load_only."""
    found = {
        r.drugbank_id
        for r in (
            db.query(Drug)
            .options(load_only(Drug.drugbank_id))   # avoid loading LONGTEXT columns
            .filter(Drug.drugbank_id.in_(drug_ids))
            .all()
        )
    }
    missing = [d for d in drug_ids if d not in found]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": "The following DrugBank IDs were not found in the database.",
                "missing": missing,
            },
        )


# ── 1. Interaction Analysis Engine ────────────────────────────────────────────

@router.post(
    "/check-interactions",
    response_model=CheckInteractionsResponse,
    summary="Analyse drug-drug interactions for a multi-drug prescription",
    description="""
Finds all pairwise drug-drug interactions among the provided list of DrugBank IDs.

- Minimum 2 drugs, maximum 20 drugs per request.
- Interactions are bidirectional (A↔B = B↔A, deduplicated).
- Returns severity breakdown and flags for major/moderate interactions.
    """,
)
def check_interactions_endpoint(
    request: CheckInteractionsRequest,
    db: Session = Depends(get_db),
):
    _validate_drug_ids(db, request.drug_ids)
    return check_interactions(db, request.drug_ids)


# ── 2. Risk Scoring Engine ────────────────────────────────────────────────────

@router.post(
    "/risk-score",
    response_model=RiskScoreResult,
    summary="Compute an overall risk score for a multi-drug prescription",
    description="""
Calculates a 0–10 risk score based on:
- Drug-drug interaction severities (major/moderate/minor)
- Shared CYP450 metabolic enzymes (pharmacokinetic risk)
- Shared protein targets (pharmacodynamic additive effects)

**Risk levels**: 0–2 = low | 2.1–5 = moderate | 5.1–7.5 = high | 7.6–10 = critical
    """,
)
def risk_score_endpoint(
    request: RiskScoreRequest,
    db: Session = Depends(get_db),
):
    _validate_drug_ids(db, request.drug_ids)
    return compute_risk_score(db, request.drug_ids)


# ── 3. Recommendation Engine ──────────────────────────────────────────────────

@router.post(
    "/recommendations",
    response_model=RecommendationResult,
    summary="Generate clinical recommendations and warnings for a prescription",
    description="""
Combines Interaction Analysis, Risk Scoring, and patient context to produce:
- Ranked list of actionable recommendations (critical → warning → caution → info)
- Patient-specific flags (renal/hepatic impairment, pregnancy, elderly)
- Overall prescription safety assessment
- `safe_to_prescribe = false` if any **critical** alert is raised

**Patient context fields** (all optional):
- `patient_age`: triggers elderly-specific warnings for age ≥ 65
- `renal_impairment`: flags nephrotoxic drugs and those requiring renal dose adjustment
- `hepatic_impairment`: flags hepatically-metabolised drugs (CYP-based)
- `pregnancy`: flags teratogenic / high pregnancy-risk drugs
    """,
)
def recommendations_endpoint(
    request: RecommendationRequest,
    db: Session = Depends(get_db),
):
    _validate_drug_ids(db, request.drug_ids)
    return generate_recommendations(
        db=db,
        drug_ids=request.drug_ids,
        patient_age=request.patient_age,
        patient_weight_kg=request.patient_weight_kg,
        renal_impairment=request.renal_impairment,
        hepatic_impairment=request.hepatic_impairment,
        pregnancy=request.pregnancy,
    )


# ── 4. Live Database Statistics ───────────────────────────────────────────────

class SystemStats(BaseModel):
    """Live counts from database — used by homepage and header."""
    drug_count: int
    interaction_count: int           # unique pairs after dedup (A<->B = B<->A)
    interaction_count_raw: int       # total rows in drug_interactions table
    protein_count: int
    drug_protein_interaction_count: int
    major_count: int
    moderate_count: int
    minor_count: int
    data_source: str = "DrugBank® v5"
    last_updated: str = "2026"
    # Phiên bản dữ liệu từ bảng system_metadata
    drugbank_version: str = "5.1.12"
    data_year: str = "2026"
    release_date: Optional[str] = None
    import_date: Optional[str] = None


@stats_router.get(
    "/stats",
    response_model=SystemStats,
    summary="Live database statistics",
    description="""
Returns live counts from the database — no hardcoded values.

- `interaction_count`: unique interaction pairs (dedup bidirectional A<->B)
- `interaction_count_raw`: total rows in drug_interactions table
- Results cached for 10 minutes to avoid COUNT(*) on 2.8M rows per request
    """,
    tags=["Statistics"],
)
def get_system_stats(db: Session = Depends(get_db)) -> SystemStats:
    CACHE_KEY = "system:stats"
    cached = cache_get(CACHE_KEY)
    if cached is not None:
        return cached

    drug_count: int = db.query(sqlfunc.count(Drug.drugbank_id)).scalar() or 0
    interaction_raw: int = db.query(sqlfunc.count(DrugInteraction.id)).scalar() or 0

    # Count unique pairs using LEAST/GREATEST — most accurate dedup method
    try:
        unique_pairs_row = db.execute(sqtext(
            "SELECT COUNT(*) FROM ("
            "  SELECT LEAST(drug_id, interacting_drug_id) AS a,"
            "         GREATEST(drug_id, interacting_drug_id) AS b"
            "  FROM drug_interactions"
            "  GROUP BY a, b"
            ") AS pairs"
        )).scalar()
        interaction_unique: int = int(unique_pairs_row or 0)
    except Exception:
        interaction_unique = interaction_raw // 2

    severity_rows = (
        db.query(DrugInteraction.severity, sqlfunc.count(DrugInteraction.id))
        .group_by(DrugInteraction.severity)
        .all()
    )
    sev_map: dict[str, int] = {(s or "unknown"): c for s, c in severity_rows}

    protein_count: int = db.query(sqlfunc.count(Protein.id)).scalar() or 0
    dpi_count: int = db.query(sqlfunc.count(DrugProteinInteraction.id)).scalar() or 0

    # ── System metadata (phiên bản DrugBank) ─────────────────────────────────
    meta = db.query(SystemMetadata).filter(SystemMetadata.id == 1).first()
    drugbank_version = meta.drugbank_version if meta else "5.1.12"
    data_year        = meta.data_year        if meta else "2026"
    release_date     = meta.release_date     if meta else None
    import_date      = meta.import_date      if meta else None

    result = SystemStats(
        drug_count=drug_count,
        interaction_count=interaction_unique,
        interaction_count_raw=interaction_raw,
        protein_count=protein_count,
        drug_protein_interaction_count=dpi_count,
        major_count=sev_map.get("major", 0),
        moderate_count=sev_map.get("moderate", 0),
        minor_count=sev_map.get("minor", 0),
        drugbank_version=drugbank_version,
        data_year=data_year,
        last_updated=data_year,
        release_date=release_date,
        import_date=import_date,
    )
    cache_set(CACHE_KEY, result, ttl=600)
    return result
