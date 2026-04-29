"""
Interaction Analysis Engine
===========================
Finds all pairwise drug-drug interactions for a given set of DrugBank IDs.

Algorithm:
  1. Fetch drug names from `drugs` table for display.
  2. Query `drug_interactions` where drug_id OR interacting_drug_id is in the input set.
  3. Filter so BOTH sides of every interaction are in the input set.
  4. Deduplicate pairs (A↔B == B↔A).
  5. Return structured CheckInteractionsResponse.
"""

from __future__ import annotations

from itertools import combinations
from typing import Dict, List, Set, Tuple

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import Drug, DrugInteraction
from app.schemas import CheckInteractionsResponse, InteractionFound


def _fetch_drug_names(db: Session, drug_ids: List[str]) -> Dict[str, str]:
    """Return {drugbank_id: name} for each requested ID."""
    rows = (
        db.query(Drug.drugbank_id, Drug.name)
        .filter(Drug.drugbank_id.in_(drug_ids))
        .all()
    )
    return {r.drugbank_id: r.name for r in rows}


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

    # ── 1. Resolve names for display ─────────────────────────────────────────
    name_map = _fetch_drug_names(db, drug_ids)

    # ── 2. Fetch candidate rows (bidirectional lookup) ────────────────────────
    # Uses: ix_di_both (drug_id, interacting_drug_id) + ix_di_interacting
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

    # ── 3. Filter + deduplicate ───────────────────────────────────────────────
    seen: Set[Tuple[str, str]] = set()
    found: List[InteractionFound] = []

    for row in rows:
        a_id = row.drug_id
        b_id = row.interacting_drug_id

        # Only include if BOTH drugs are in the request set
        if a_id not in id_set or b_id not in id_set:
            continue

        pair = (min(a_id, b_id), max(a_id, b_id))
        if pair in seen:
            continue
        seen.add(pair)

        a_name = name_map.get(a_id, a_id)
        b_name = row.interacting_drug_name or name_map.get(b_id, b_id)

        found.append(
            InteractionFound(
                drug_a_id=a_id,
                drug_a_name=a_name,
                drug_b_id=b_id,
                drug_b_name=b_name,
                severity=row.severity or "unknown",
                description=row.description or "",
            )
        )

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
