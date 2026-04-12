"""
Clinical Analysis API
======================
Endpoints that power the three core CDSS engines:

  POST /api/v1/analysis/check-interactions  → Interaction Analysis Engine
  POST /api/v1/analysis/risk-score          → Risk Scoring Engine
  POST /api/v1/analysis/recommendations     → Recommendation Engine

All endpoints accept JSON bodies and return structured JSON.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.interaction_engine import check_interactions
from app.core.recommendation_engine import generate_recommendations
from app.core.risk_engine import compute_risk_score
from app.database import get_db
from app.models import Drug
from app.schemas import (
    CheckInteractionsRequest,
    CheckInteractionsResponse,
    RecommendationRequest,
    RecommendationResult,
    RiskScoreRequest,
    RiskScoreResult,
)

router = APIRouter(prefix="/api/v1/analysis", tags=["Clinical Analysis"])


def _validate_drug_ids(db: Session, drug_ids: list[str]) -> None:
    """Raise 422 if any drug_id is not found in the database."""
    found = {
        r.drugbank_id
        for r in db.query(Drug.drugbank_id).filter(Drug.drugbank_id.in_(drug_ids)).all()
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
