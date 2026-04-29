"""
Risk Scoring Engine
===================
Computes a 0–10 numeric risk score from a set of drug-drug interactions
and shared pharmacokinetic targets (CYP enzymes, transporters).

Scoring model
-------------
Base score from severity:
  major    → +4.0 per interaction
  moderate → +2.0 per interaction
  minor    → +0.5 per interaction
  unknown  → +1.0 per interaction
  (capped at 8.0 from interactions alone)

Pharmacokinetic potentiation:
  shared CYP enzyme   → +1.0 per shared enzyme  (max +2.0)
  shared target       → +0.5 per shared target  (max +1.0)

Risk levels
-----------
  0.0 – 2.0  → low
  2.1 – 5.0  → moderate
  5.1 – 7.5  → high
  7.6 – 10.0 → critical
"""

from __future__ import annotations

from typing import Dict, List

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.interaction_engine import check_interactions
from app.models import Drug, DrugProteinInteraction
from app.schemas import (
    RiskScoreResult,
    SeverityBreakdown,
)

_SEVERITY_WEIGHTS: Dict[str, float] = {
    "major": 4.0,
    "moderate": 2.0,
    "minor": 0.5,
    "unknown": 1.0,
}

_RISK_LEVELS = [
    (2.0, "low"),
    (5.0, "moderate"),
    (7.5, "high"),
    (10.0, "critical"),
]

_CYP_KEYWORDS = {
    "cyp1a2", "cyp2c9", "cyp2c19", "cyp2d6",
    "cyp3a4", "cyp3a5", "cyp2b6", "cyp2e1",
}


def _classify_risk(score: float) -> str:
    for threshold, level in _RISK_LEVELS:
        if score <= threshold:
            return level
    return "critical"


def _get_enzyme_and_target_names(
    db: Session, drug_ids: List[str]
) -> Dict[str, List[str]]:
    """
    Return {drugbank_id: [uniprot_id, ...]} for enzymes and targets.
    Used to detect shared pharmacokinetic proteins between drugs in the list.
    """
    rows = (
        db.query(
            DrugProteinInteraction.drug_id,
            DrugProteinInteraction.uniprot_id,
            DrugProteinInteraction.interaction_type,
        )
        .filter(DrugProteinInteraction.drug_id.in_(drug_ids))
        .all()
    )
    mapping: Dict[str, List[str]] = {}
    for r in rows:
        uid = (r.uniprot_id or "").lower()
        if uid:
            mapping.setdefault(r.drug_id, []).append(uid)
    return mapping


def compute_risk_score(db: Session, drug_ids: List[str]) -> RiskScoreResult:
    """
    Compute a risk score for the given prescription (list of DrugBank IDs).

    Parameters
    ----------
    db       : SQLAlchemy Session
    drug_ids : List of DrugBank IDs

    Returns
    -------
    RiskScoreResult
    """
    # ── 1. Run interaction analysis ───────────────────────────────────────────
    analysis = check_interactions(db, drug_ids)
    interactions = analysis.interactions_found

    # ── 2. Severity breakdown ─────────────────────────────────────────────────
    breakdown = SeverityBreakdown()
    interaction_score = 0.0
    for ix in interactions:
        sev = (ix.severity or "unknown").lower()
        weight = _SEVERITY_WEIGHTS.get(sev, 1.0)
        interaction_score += weight
        if sev == "major":
            breakdown.major += 1
        elif sev == "moderate":
            breakdown.moderate += 1
        elif sev == "minor":
            breakdown.minor += 1
        else:
            breakdown.unknown += 1

    interaction_score = min(interaction_score, 8.0)

    # ── 3. Shared enzyme / target bonus ──────────────────────────────────────
    protein_map = _get_enzyme_and_target_names(db, drug_ids)

    # Collect protein sets per drug
    protein_sets = list(protein_map.values())
    shared_all: set[str] = set()
    if len(protein_sets) >= 2:
        shared_all = set(protein_sets[0])
        for ps in protein_sets[1:]:
            shared_all &= set(ps)

    shared_enzymes = sorted(
        uid for uid in shared_all if any(cyp in uid for cyp in _CYP_KEYWORDS)
    )
    shared_targets = sorted(shared_all - set(shared_enzymes))

    enzyme_bonus = min(len(shared_enzymes) * 1.0, 2.0)
    target_bonus = min(len(shared_targets) * 0.5, 1.0)

    # ── 4. Final score ────────────────────────────────────────────────────────
    raw_score = interaction_score + enzyme_bonus + target_bonus
    final_score = round(min(raw_score, 10.0), 2)
    risk_level = _classify_risk(final_score)

    # ── 5. Explanation ────────────────────────────────────────────────────────
    parts = []
    if interactions:
        parts.append(
            f"{len(interactions)} interaction(s) detected "
            f"({breakdown.major} major, {breakdown.moderate} moderate, "
            f"{breakdown.minor} minor, {breakdown.unknown} unknown)"
        )
    if shared_enzymes:
        parts.append(f"shared CYP enzymes: {', '.join(shared_enzymes)}")
    if shared_targets:
        parts.append(f"shared protein targets: {len(shared_targets)} common protein(s)")
    explanation = "; ".join(parts) if parts else "No significant interactions detected."

    return RiskScoreResult(
        drug_ids=drug_ids,
        score=final_score,
        risk_level=risk_level,
        severity_breakdown=breakdown,
        shared_enzymes=shared_enzymes,
        shared_targets=shared_targets,
        total_interactions=len(interactions),
        explanation=explanation,
    )
