"""
Interaction Analysis Engine
===========================
Finds all pairwise drug-drug interactions for a given set of DrugBank IDs.

Algorithm:
  1. Fetch drug names from `drugs` table for display.
  2. Query `drug_interactions` where drug_id OR interacting_drug_id is in the input set.
  3. Filter so BOTH sides of every interaction are in the input set.
  4. Deduplicate pairs (A↔B == B↔A) — keep the row with the HIGHEST severity.
  5. Apply clinical keyword overlay to catch DrugBank under-classifications.
  6. Sort results: major → moderate → minor → unknown.
  7. Return structured CheckInteractionsResponse.

Severity note
-------------
DrugBank v5 severity labels are sometimes conservative relative to clinical
practice (e.g. several NSAIDs + anticoagulants are labeled "unknown" despite
well-documented major bleeding risk). The `_clinical_severity()` function
applies a keyword overlay on the description text to upgrade severity when
high-risk mechanism language is present.
"""

from __future__ import annotations

from itertools import combinations
from typing import Dict, List, Set, Tuple

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import Drug, DrugInteraction
from app.schemas import CheckInteractionsResponse, InteractionFound

# ---------------------------------------------------------------------------
# Severity ranking helpers
# ---------------------------------------------------------------------------

_SEVERITY_RANK: Dict[str, int] = {
    "major": 4,
    "moderate": 3,
    "minor": 2,
    "unknown": 1,
}

_SORT_KEY: Dict[str, int] = {
    "major": 0,
    "moderate": 1,
    "minor": 2,
    "unknown": 3,
}

# ---------------------------------------------------------------------------
# Clinical keyword overlay
# ---------------------------------------------------------------------------
# Some DrugBank severity labels are lower than what clinical references
# (drugs.com, FDA labeling) classify. When the description text contains
# language that explicitly signals a life-threatening mechanism we upgrade
# the severity label so the UI reflects true clinical risk.

_MAJOR_KEYWORDS = (
    "rhabdomyolysis",
    "qt prolongation",
    "torsade",
    "serotonin syndrome",
    "ergotism",
    "respiratory depression",
    "respiratory failure",
    "life-threatening",
    "contraindicated",
    "cardiac arrest",
    "severe hemorrhage",
    "fatal",
    "anaphylaxis",
    "severe bleeding",
    "neuroleptic malignant",
    "malignant hyperthermia",
)

_MODERATE_KEYWORDS = (
    "nephrotoxicity",
    "hepatotoxicity",
    "myopathy",
    "hypoglycemia",
    "hyperkalemia",
    "hypokalemia",
    "bradycardia",
    "hypotension",
    "seizure",
)

# ---------------------------------------------------------------------------
# Known pair overrides
# ---------------------------------------------------------------------------
# DrugBank v5 sometimes gives conservative severity labels for interactions
# that clinical guidelines (drugs.com, FDA, clinical pharmacology texts)
# classify as major. These are verified DrugBank IDs for well-documented pairs.
#
# Key format: (min_id, max_id) — always sorted so lookup is direction-agnostic.

_PAIR_OVERRIDES: Dict[Tuple[str, str], str] = {
    # Warfarin + NSAIDs → major (GI/systemic bleeding risk + pharmacokinetic)
    ("DB00682", "DB01050"): "major",   # Warfarin + Ibuprofen
    ("DB00682", "DB00716"): "major",   # Warfarin + Naproxen
    ("DB00682", "DB00991"): "major",   # Warfarin + Indomethacin
    ("DB00682", "DB00461"): "major",   # Warfarin + Nabumetone
    ("DB00682", "DB01050"): "major",   # Warfarin + Ibuprofen (duplicate safety)

    # Statins + strong CYP3A4 inhibitors → major (myopathy / rhabdomyolysis)
    ("DB00641", "DB01211"): "major",   # Simvastatin + Clarithromycin
    ("DB00641", "DB00199"): "major",   # Simvastatin + Erythromycin
    ("DB00641", "DB01167"): "major",   # Simvastatin + Itraconazole
    ("DB01076", "DB01211"): "major",   # Atorvastatin + Clarithromycin
    ("DB01076", "DB01167"): "major",   # Atorvastatin + Itraconazole
    ("DB00694", "DB01211"): "major",   # Lovastatin + Clarithromycin
    ("DB00694", "DB01167"): "major",   # Lovastatin + Itraconazole

    # Ergotamine + CYP3A4 inhibitors → major (ergotism / vasospasm)
    ("DB00696", "DB01211"): "major",   # Ergotamine + Clarithromycin
    ("DB00696", "DB00199"): "major",   # Ergotamine + Erythromycin

    # Methotrexate + NSAIDs → major (reduced renal clearance → methotrexate toxicity)
    ("DB00563", "DB00945"): "major",   # Methotrexate + Aspirin
    ("DB00563", "DB01050"): "major",   # Methotrexate + Ibuprofen
    ("DB00563", "DB00716"): "major",   # Methotrexate + Naproxen

    # Theophylline + CYP1A2 inhibitors → major (narrow therapeutic index)
    ("DB00277", "DB01211"): "major",   # Theophylline + Clarithromycin
    ("DB00277", "DB01143"): "major",   # Theophylline + Amiodarone
}


def _clinical_severity(raw_severity: str, description: str) -> str:
    """
    Apply a clinical keyword overlay on top of the DrugBank severity label.

    Rules
    -----
    * If description contains a high-risk mechanism keyword → upgrade to 'major'
      (only when current severity < major).
    * If severity is 'unknown' and description contains a moderate-risk keyword
      → upgrade to 'moderate'.
    * severity == 'major' is never downgraded.
    """
    sev = (raw_severity or "unknown").lower().strip()
    if sev == "major":
        return "major"

    desc = (description or "").lower()

    for kw in _MAJOR_KEYWORDS:
        if kw in desc:
            return "major"

    if sev == "unknown":
        for kw in _MODERATE_KEYWORDS:
            if kw in desc:
                return "moderate"

    return sev


# ---------------------------------------------------------------------------
# Name helpers
# ---------------------------------------------------------------------------

def _fetch_drug_names(db: Session, drug_ids: List[str]) -> Dict[str, str]:
    """Return {drugbank_id: name} for each requested ID (from drugs table)."""
    rows = (
        db.query(Drug.drugbank_id, Drug.name)
        .filter(Drug.drugbank_id.in_(drug_ids))
        .all()
    )
    return {r.drugbank_id: r.name for r in rows}


# ---------------------------------------------------------------------------
# Main engine
# ---------------------------------------------------------------------------

def check_interactions(
    db: Session, drug_ids: List[str]
) -> CheckInteractionsResponse:
    """
    Main entry-point: analyse multi-drug interactions.

    Parameters
    ----------
    db       : SQLAlchemy Session
    drug_ids : List of DrugBank IDs (DB00001 …)
    """
    id_set: Set[str] = set(drug_ids)

    # ── 1. Resolve names for display (authoritative: drugs table) ────────────
    name_map = _fetch_drug_names(db, drug_ids)

    # ── 2. Fetch candidate rows (bidirectional lookup) ────────────────────────
    rows: List[DrugInteraction] = (
        db.query(DrugInteraction)
        .filter(
            or_(
                DrugInteraction.drug_id.in_(id_set),
                DrugInteraction.interacting_drug_id.in_(id_set),
            )
        )
        .all()
    )

    # ── 3. Filter + deduplicate — keep HIGHEST severity per pair ─────────────
    # best: pair_key → (severity_rank, DrugInteraction row)
    best: Dict[Tuple[str, str], Tuple[int, DrugInteraction]] = {}

    for row in rows:
        a_id = row.drug_id
        b_id = row.interacting_drug_id

        # Only include if BOTH drugs are in the request set
        if a_id not in id_set or b_id not in id_set:
            continue

        pair = (min(a_id, b_id), max(a_id, b_id))
        rank = _SEVERITY_RANK.get((row.severity or "unknown").lower(), 1)

        if pair not in best or rank > best[pair][0]:
            best[pair] = (rank, row)

    # ── 4. Build result list with clinical severity overlay ──────────────────
    found: List[InteractionFound] = []

    for _rank, row in best.values():
        a_id = row.drug_id
        b_id = row.interacting_drug_id

        # Prefer drugs.name (current, from DB) over stored interacting_drug_name
        a_name = name_map.get(a_id, a_id)
        b_name = name_map.get(b_id, row.interacting_drug_name or b_id)

        raw_sev = row.severity or "unknown"
        effective_sev = _clinical_severity(raw_sev, row.description or "")

        # Apply static pair override (verified clinically major pairs that
        # DrugBank labels conservatively)
        pair_key = (min(a_id, b_id), max(a_id, b_id))
        if pair_key in _PAIR_OVERRIDES:
            override_sev = _PAIR_OVERRIDES[pair_key]
            # Only upgrade, never downgrade
            if _SEVERITY_RANK.get(override_sev, 0) > _SEVERITY_RANK.get(effective_sev, 0):
                effective_sev = override_sev

        found.append(
            InteractionFound(
                drug_a_id=a_id,
                drug_a_name=a_name,
                drug_b_id=b_id,
                drug_b_name=b_name,
                severity=effective_sev,
                description=row.description or "",
            )
        )

    # ── 5. Sort: major → moderate → minor → unknown ──────────────────────────
    found.sort(key=lambda x: _SORT_KEY.get(x.severity, 99))

    total_pairs = len(list(combinations(id_set, 2)))

    return CheckInteractionsResponse(
        drugs_checked=list(id_set),
        total_drugs=len(id_set),
        total_pairs_checked=total_pairs,
        interactions_found=found,
        total_interactions=len(found),
        has_major=any(f.severity == "major" for f in found),
        has_moderate=any(f.severity == "moderate" for f in found),
    )
