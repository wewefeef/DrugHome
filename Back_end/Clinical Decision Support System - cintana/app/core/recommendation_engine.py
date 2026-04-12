"""
Recommendation Engine
=====================
Generates clinical recommendations and warnings based on:
  • Detected drug-drug interactions (from InteractionEngine)
  • Risk score (from RiskEngine)
  • Patient context (age, renal/hepatic impairment, pregnancy)

Each recommendation has:
  level   : critical | warning | caution | info
  type    : drug_interaction | renal_risk | hepatic_risk | pregnancy_risk | age_risk | info
  message : human-readable explanation
  action  : prescriber action suggestion
"""

from __future__ import annotations

from typing import List, Optional

from sqlalchemy.orm import Session

from app.core.interaction_engine import check_interactions
from app.core.risk_engine import compute_risk_score
from app.models import Drug
from app.schemas import (
    RecommendationItem,
    RecommendationResult,
)

# ── Severity → recommendation level mapping ──────────────────────────────────
_SEVERITY_TO_LEVEL = {
    "major": "critical",
    "moderate": "warning",
    "minor": "caution",
    "unknown": "caution",
}

# ── High-risk keywords for special metabolic warnings ────────────────────────
_NARROW_TI_KEYWORDS = [
    "narrow therapeutic", "warfarin", "digoxin", "lithium",
    "phenytoin", "theophylline", "cyclosporine", "methotrexate",
    "aminoglycoside",
]
_RENAL_CAUTION_KEYWORDS = [
    "renal", "kidney", "nephrotoxic", "creatinine", "clearance",
    "hemodialysis", "hemofiltration",
]
_HEPATIC_CAUTION_KEYWORDS = [
    "hepatic", "liver", "hepatotoxic", "cirrhosis", "cyp3a4",
    "cyp2c9", "cyp2c19",
]
_PREGNANCY_CAUTION_KEYWORDS = [
    "fetal", "embryo", "teratogen", "pregnancy", "lactation",
    "breast", "placental",
]


def _contains_any(text: str, keywords: List[str]) -> bool:
    lower = text.lower()
    return any(kw in lower for kw in keywords)


def _build_interaction_recommendations(
    interactions, drug_ids: List[str]
) -> List[RecommendationItem]:
    recs: List[RecommendationItem] = []
    for ix in interactions:
        level = _SEVERITY_TO_LEVEL.get((ix.severity or "").lower(), "caution")
        if level == "critical":
            action = (
                "Avoid concurrent use. Consider alternative therapy. "
                "If co-administration is unavoidable, monitor closely."
            )
        elif level == "warning":
            action = (
                "Use with caution. Consider dose adjustment or enhanced monitoring. "
                "Evaluate risk-benefit ratio."
            )
        else:
            action = "Monitor patient for adverse effects. Adjust dose if necessary."

        recs.append(
            RecommendationItem(
                level=level,
                type="drug_interaction",
                drug_ids_involved=[ix.drug_a_id, ix.drug_b_id],
                message=(
                    f"{ix.drug_a_name} ↔ {ix.drug_b_name} "
                    f"[{ix.severity or 'unknown'} severity]: {ix.description}"
                ),
                action=action,
            )
        )
    return recs


def _build_patient_recommendations(
    db: Session,
    drug_ids: List[str],
    patient_age: Optional[int],
    patient_weight_kg: Optional[float],
    renal_impairment: bool,
    hepatic_impairment: bool,
    pregnancy: bool,
) -> List[RecommendationItem]:
    recs: List[RecommendationItem] = []

    # Fetch drugs to scan their description/toxicity/metabolism text
    drugs = (
        db.query(Drug)
        .filter(Drug.drugbank_id.in_(drug_ids))
        .all()
    )

    for drug in drugs:
        combined_text = " ".join(
            filter(
                None,
                [
                    drug.description, drug.toxicity, drug.metabolism,
                    drug.absorption, drug.route_of_elimination,
                ],
            )
        )

        # ── Renal impairment ─────────────────────────────────────────────────
        if renal_impairment and _contains_any(combined_text, _RENAL_CAUTION_KEYWORDS):
            recs.append(
                RecommendationItem(
                    level="warning",
                    type="renal_risk",
                    drug_ids_involved=[drug.drugbank_id],
                    message=(
                        f"{drug.name}: renal impairment may affect drug clearance "
                        "or increase nephrotoxicity risk."
                    ),
                    action=(
                        "Reduce dose or increase dosing interval based on GFR/CrCl. "
                        "Monitor renal function regularly."
                    ),
                )
            )

        # ── Hepatic impairment ───────────────────────────────────────────────
        if hepatic_impairment and _contains_any(combined_text, _HEPATIC_CAUTION_KEYWORDS):
            recs.append(
                RecommendationItem(
                    level="warning",
                    type="hepatic_risk",
                    drug_ids_involved=[drug.drugbank_id],
                    message=(
                        f"{drug.name}: hepatic impairment may reduce first-pass "
                        "metabolism and increase drug exposure."
                    ),
                    action=(
                        "Reduce dose in severe hepatic impairment. "
                        "Monitor liver function tests (LFTs). "
                        "Consider alternatives metabolised outside the liver."
                    ),
                )
            )

        # ── Pregnancy ────────────────────────────────────────────────────────
        if pregnancy and _contains_any(combined_text, _PREGNANCY_CAUTION_KEYWORDS):
            recs.append(
                RecommendationItem(
                    level="critical",
                    type="pregnancy_risk",
                    drug_ids_involved=[drug.drugbank_id],
                    message=(
                        f"{drug.name}: potential risk during pregnancy or lactation "
                        "based on drug information."
                    ),
                    action=(
                        "Avoid unless clearly necessary. "
                        "Consult obstetrics and weigh risk-benefit carefully. "
                        "Use the lowest effective dose if essential."
                    ),
                )
            )

        # ── Elderly patients (age ≥ 65) ──────────────────────────────────────
        if patient_age is not None and patient_age >= 65:
            if _contains_any(combined_text, _NARROW_TI_KEYWORDS):
                recs.append(
                    RecommendationItem(
                        level="caution",
                        type="age_risk",
                        drug_ids_involved=[drug.drugbank_id],
                        message=(
                            f"{drug.name}: narrow therapeutic index drug in an "
                            "elderly patient (≥65) — pharmacokinetics may differ."
                        ),
                        action=(
                            "Start low, go slow (START LOW principle). "
                            "Adjust dose for reduced renal/hepatic reserve. "
                            "Monitor drug levels if available."
                        ),
                    )
                )

    return recs


def generate_recommendations(
    db: Session,
    drug_ids: List[str],
    patient_age: Optional[int] = None,
    patient_weight_kg: Optional[float] = None,
    renal_impairment: bool = False,
    hepatic_impairment: bool = False,
    pregnancy: bool = False,
) -> RecommendationResult:
    """
    Generate full clinical recommendations for the given prescription.

    Parameters
    ----------
    db                  : SQLAlchemy Session
    drug_ids            : DrugBank IDs in the prescription
    patient_age         : Patient age in years (optional)
    patient_weight_kg   : Patient weight in kg (optional)
    renal_impairment    : True if patient has renal impairment
    hepatic_impairment  : True if patient has hepatic impairment
    pregnancy           : True if patient is pregnant / breastfeeding

    Returns
    -------
    RecommendationResult
    """
    # ── Risk score ────────────────────────────────────────────────────────────
    risk = compute_risk_score(db, drug_ids)
    analysis = check_interactions(db, drug_ids)

    # ── Build recommendations ─────────────────────────────────────────────────
    recs: List[RecommendationItem] = []
    recs.extend(_build_interaction_recommendations(analysis.interactions_found, drug_ids))
    recs.extend(
        _build_patient_recommendations(
            db, drug_ids,
            patient_age, patient_weight_kg,
            renal_impairment, hepatic_impairment, pregnancy,
        )
    )

    # Sort: critical → warning → caution → info
    _level_order = {"critical": 0, "warning": 1, "caution": 2, "info": 3}
    recs.sort(key=lambda r: _level_order.get(r.level, 99))

    # ── Safe-to-prescribe flag ────────────────────────────────────────────────
    safe = not any(r.level == "critical" for r in recs)

    # ── Human-readable summary ────────────────────────────────────────────────
    if not recs:
        summary = (
            f"No significant interactions or clinical risks identified for the "
            f"{len(drug_ids)}-drug prescription. Risk score: {risk.score}/10 ({risk.risk_level})."
        )
    else:
        critical_count = sum(1 for r in recs if r.level == "critical")
        warning_count = sum(1 for r in recs if r.level == "warning")
        caution_count = sum(1 for r in recs if r.level == "caution")
        parts = []
        if critical_count:
            parts.append(f"{critical_count} critical alert(s)")
        if warning_count:
            parts.append(f"{warning_count} warning(s)")
        if caution_count:
            parts.append(f"{caution_count} caution note(s)")
        summary = (
            f"Prescription review: {'; '.join(parts)}. "
            f"Overall risk score: {risk.score}/10 ({risk.risk_level}). "
            f"{'Prescription NOT recommended as-is.' if not safe else 'Prescription acceptable with monitoring.'}"
        )

    return RecommendationResult(
        drug_ids=drug_ids,
        risk_score=risk.score,
        risk_level=risk.risk_level,
        recommendations=recs,
        summary=summary,
        safe_to_prescribe=safe,
    )
