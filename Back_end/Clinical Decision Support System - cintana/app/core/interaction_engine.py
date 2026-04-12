"""
Interaction Analysis Engine
===========================
Finds all pairwise drug-drug interactions for a given set of DrugBank IDs.

Algorithm:
  1. Resolve each DrugBank ID → drug_code (DR:XXXXX) via the `drugs` table.
  2. Query `drug_interactions` for all rows where drug_code OR interacting_drug_id
     matches any drug in the input set (bidirectional lookup).
  3. Filter so both sides of every interaction are in the input set.
  4. Deduplicate pairs (A↔B == B↔A).
  5. Return structured InteractionFound list.
"""

from __future__ import annotations

from itertools import combinations
from typing import Dict, List, Tuple

from sqlalchemy import or_, and_
from sqlalchemy.orm import Session

from app.models import Drug, DrugInteraction
from app.schemas import CheckInteractionsResponse, InteractionFound


def _resolve_drugs(
    db: Session, drug_ids: List[str]
) -> Dict[str, Tuple[str, str]]:
    """
    Return {drugbank_id: (drug_code, name)} for each requested ID.
    Unknown IDs are silently skipped.
    """
    rows = (
        db.query(Drug.drugbank_id, Drug.drug_code, Drug.name)
        .filter(Drug.drugbank_id.in_(drug_ids))
        .all()
    )
    return {r.drugbank_id: (r.drug_code, r.name) for r in rows}


def check_interactions(
    db: Session, drug_ids: List[str]
) -> CheckInteractionsResponse:
    """
    Main entry‑point: analyse multi‑drug interactions.

    Parameters
    ----------
    db       : SQLAlchemy Session
    drug_ids : List of DrugBank IDs (DB00001 …)

    Returns
    -------
    CheckInteractionsResponse
    """
    # ── 1. Resolve IDs ────────────────────────────────────────────────────────
    resolved = _resolve_drugs(db, drug_ids)
    resolved_codes = {v[0] for v in resolved.values()}   # set of DR:XXXXX
    resolved_dbids = set(resolved.keys())                 # set of DB00001

    # ── 2. Fetch candidate rows ───────────────────────────────────────────────
    rows: List[DrugInteraction] = (
        db.query(DrugInteraction)
        .filter(
            or_(
                and_(
                    DrugInteraction.drug_code.in_(resolved_codes),
                    DrugInteraction.interacting_drug_id.in_(resolved_dbids),
                ),
                and_(
                    DrugInteraction.drug_drugbank_id.in_(resolved_dbids),
                    DrugInteraction.interacting_drug_id.in_(resolved_dbids),
                ),
            )
        )
        .all()
    )

    # ── 3. Build reverse lookup drugbank_id → (drug_code, name) ──────────────
    code_to_dbid: Dict[str, str] = {v[0]: k for k, v in resolved.items()}

    # ── 4. Deduplicate & filter ───────────────────────────────────────────────
    seen: set[Tuple[str, str]] = set()
    found: List[InteractionFound] = []

    for row in rows:
        a_dbid = row.drug_drugbank_id or code_to_dbid.get(row.drug_code, "")
        b_dbid = row.interacting_drug_id

        # Only include if BOTH drugs are in the request set
        if a_dbid not in resolved_dbids or b_dbid not in resolved_dbids:
            continue

        pair = (min(a_dbid, b_dbid), max(a_dbid, b_dbid))
        if pair in seen:
            continue
        seen.add(pair)

        a_name = resolved.get(a_dbid, ("", a_dbid))[1] if a_dbid else a_dbid
        b_name = (
            row.interacting_drug_name
            or (resolved.get(b_dbid, ("", b_dbid))[1] if b_dbid else b_dbid)
        )

        found.append(
            InteractionFound(
                drug_a_id=a_dbid,
                drug_a_name=a_name,
                drug_b_id=b_dbid,
                drug_b_name=b_name,
                severity=row.severity or "unknown",
                description=row.description or "",
            )
        )

    total_pairs = len(list(combinations(resolved_dbids, 2)))

    return CheckInteractionsResponse(
        drugs_checked=list(resolved_dbids),
        total_drugs=len(resolved_dbids),
        total_pairs_checked=total_pairs,
        interactions_found=found,
        total_interactions=len(found),
        has_major=any(i.severity == "major" for i in found),
        has_moderate=any(i.severity == "moderate" for i in found),
    )
