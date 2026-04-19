"""
Drug CRUD API
=============
RESTful endpoints for managing drugs.

Routes
------
GET    /api/v1/drugs/                → list & search drugs (paginated)
GET    /api/v1/drugs/{drugbank_id}   → get one drug (full detail)
POST   /api/v1/drugs/                → create a new drug
PATCH  /api/v1/drugs/{drugbank_id}   → partial update a drug
DELETE /api/v1/drugs/{drugbank_id}   → delete a drug
"""

from __future__ import annotations

import re
from math import ceil
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, text
from sqlalchemy.orm import Session

from sqlalchemy import func as sqlfunc

from app.database import get_db
from app.models import Drug, DrugProteinInteraction
from app.schemas import DrugCreate, DrugOut, DrugUpdate, PaginatedResponse
from app.core.simple_cache import cache_get, cache_set, cache_delete, cache_delete_prefix


def _build_fulltext_query(raw: str) -> str:
    """Convert a user search string to MySQL boolean FULLTEXT format.

    Each word becomes ``+word*`` (must contain, prefix match).
    Words shorter than 3 chars are included as-is (no prefix) because
    MySQL's minimum token size is 3 by default.
    """
    words = raw.strip().split()
    parts = []
    for w in words:
        w = re.sub(r'[+\-><()\~*"@]', '', w)  # strip FULLTEXT operators
        if not w:
            continue
        parts.append(f"+{w}*" if len(w) >= 3 else w)
    return " ".join(parts) if parts else raw

router = APIRouter(prefix="/api/v1/drugs", tags=["Drugs"])


# ── Read: list ────────────────────────────────────────────────────────────────

@router.get("", response_model=PaginatedResponse, summary="List / search drugs")
def list_drugs(
    q: str = Query(default="", description="Search by name, DrugBank ID, or CAS"),
    drug_type: str = Query(default="", description="Filter: small molecule | biotech"),
    state: str = Query(default="", description="Filter: solid | liquid | gas"),
    group: str = Query(default="", description="Filter by group e.g. approved"),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=500),
    db: Session = Depends(get_db),
):
    cache_key = f"drugs:list:{q}:{drug_type}:{state}:{group}:{page}:{per_page}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    qs = db.query(Drug)

    if q.strip():
        query = q.strip()

        # ── Check for exact DrugBank ID pattern first (DB00001…) ──────────────
        id_match = re.search(r"\b(DB\d{4,})\b", query, re.IGNORECASE)
        if id_match:
            # Exact lookup → hits unique index directly, O(1)
            qs = qs.filter(Drug.drugbank_id == id_match.group(1).upper())
        elif len(query) >= 3:
            # ── FULLTEXT search (fast, uses ix_drugs_name_ft index) ───────────
            # MATCH(name) AGAINST('+asp* +cal*' IN BOOLEAN MODE)
            ft_q = _build_fulltext_query(query)
            qs = qs.filter(
                or_(
                    # Primary: FULLTEXT on name column (very fast for 17k+ rows)
                    text("MATCH(name) AGAINST(:ft_q IN BOOLEAN MODE)"),
                    # Fallback: CAS number prefix match (hits B-tree index)
                    Drug.cas_number.like(f"{query}%"),
                    # Fallback: DrugBank ID prefix (hits unique B-tree index)
                    Drug.drugbank_id.like(f"{query.upper()}%"),
                )
            ).params(ft_q=ft_q)
        else:
            # Ultra-short query (1–2 chars): prefix only to stay index-friendly
            qs = qs.filter(
                or_(
                    Drug.name.like(f"{query}%"),
                    Drug.drugbank_id.like(f"{query.upper()}%"),
                )
            )

    if drug_type.strip():
        qs = qs.filter(Drug.drug_type == drug_type.strip())

    if state.strip():
        qs = qs.filter(Drug.state == state.strip())

    if group.strip():
        # drug_groups is pipe-separated (e.g. "approved|withdrawn").
        # Use prefix-friendly LIKE when the group is a whole token.
        # The ix_drugs_groups prefix index helps here.
        g = group.strip()
        qs = qs.filter(
            or_(
                Drug._drug_groups_raw.like(f"{g}|%"),    # group at start
                Drug._drug_groups_raw.like(f"%|{g}|%"),  # group in middle
                Drug._drug_groups_raw.like(f"%|{g}"),    # group at end
                Drug._drug_groups_raw == g,               # only group
            )
        )

    total = qs.count()
    offset = (page - 1) * per_page
    drugs = qs.order_by(Drug.name).offset(offset).limit(per_page).all()

    # Batch-compute protein interaction counts for all drugs on this page
    drugbank_ids = [d.drugbank_id for d in drugs]
    counts_map: dict[str, dict[str, int]] = {}
    if drugbank_ids:
        count_rows = (
            db.query(
                DrugProteinInteraction.drug_drugbank_id,
                DrugProteinInteraction.interaction_type,
                sqlfunc.count(DrugProteinInteraction.id).label("cnt"),
            )
            .filter(DrugProteinInteraction.drug_drugbank_id.in_(drugbank_ids))
            .group_by(
                DrugProteinInteraction.drug_drugbank_id,
                DrugProteinInteraction.interaction_type,
            )
            .all()
        )
        for dbid, itype, cnt in count_rows:
            counts_map.setdefault(dbid, {})[itype] = cnt

    items = []
    for d in drugs:
        out = DrugOut.model_validate(d)
        c = counts_map.get(d.drugbank_id, {})
        out.target_count = c.get("target", 0)
        out.enzyme_count = c.get("enzyme", 0)
        out.transporter_count = c.get("transporter", 0)
        items.append(out)

    result = PaginatedResponse(
        total=total,
        page=page,
        per_page=per_page,
        total_pages=ceil(total / per_page) if total else 0,
        items=items,
    )
    cache_set(cache_key, result, ttl=300)
    return result


# ── Read: single ──────────────────────────────────────────────────────────────

@router.get("/{drugbank_id}", response_model=DrugOut, summary="Get a single drug")
def get_drug(drugbank_id: str, db: Session = Depends(get_db)):
    detail_key = f"drugs:detail:{drugbank_id.upper()}"
    cached = cache_get(detail_key)
    if cached is not None:
        return cached

    drug = (
        db.query(Drug)
        .filter(Drug.drugbank_id == drugbank_id.upper())
        .first()
    )
    if not drug:
        raise HTTPException(status_code=404, detail=f"Drug '{drugbank_id}' not found")
    result = DrugOut.model_validate(drug)
    # Compute protein interaction counts by type
    counts = (
        db.query(DrugProteinInteraction.interaction_type, sqlfunc.count(DrugProteinInteraction.id))
        .filter(DrugProteinInteraction.drug_drugbank_id == drugbank_id.upper())
        .group_by(DrugProteinInteraction.interaction_type)
        .all()
    )
    for itype, cnt in counts:
        if itype == "target":
            result.target_count = cnt
        elif itype == "enzyme":
            result.enzyme_count = cnt
        elif itype == "transporter":
            result.transporter_count = cnt
    cache_set(detail_key, result, ttl=600)
    return result


# ── Create ────────────────────────────────────────────────────────────────────

@router.post(
    "/",
    response_model=DrugOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new drug",
)
def create_drug(payload: DrugCreate, db: Session = Depends(get_db)):
    # Uniqueness checks
    if db.query(Drug).filter(Drug.drugbank_id == payload.drugbank_id.upper()).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"DrugBank ID '{payload.drugbank_id}' already exists",
        )
    if db.query(Drug).filter(Drug.drug_code == payload.drug_code).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Drug code '{payload.drug_code}' already exists",
        )

    drug = Drug(
        drug_code=payload.drug_code,
        drugbank_id=payload.drugbank_id.upper(),
        name=payload.name,
        drug_type=payload.drug_type,
        _drug_groups_raw=payload.drug_groups,
        atc_codes=payload.atc_codes,
        inchikey=payload.inchikey,
        cas_number=payload.cas_number,
        unii=payload.unii,
        state=payload.state,
        description=payload.description,
        indication=payload.indication,
        pharmacodynamics=payload.pharmacodynamics,
        mechanism_of_action=payload.mechanism_of_action,
        toxicity=payload.toxicity,
        metabolism=payload.metabolism,
        absorption=payload.absorption,
        half_life=payload.half_life,
        protein_binding=payload.protein_binding,
        route_of_elimination=payload.route_of_elimination,
        _categories_json=payload.categories,
        _aliases_json=payload.aliases,
        _chemical_properties_json=payload.chemical_properties,
        _external_mappings_json=payload.external_mappings,
    )
    db.add(drug)
    db.commit()
    db.refresh(drug)
    cache_delete_prefix("drugs:list:")
    return DrugOut.model_validate(drug)


# ── Update ────────────────────────────────────────────────────────────────────

@router.patch("/{drugbank_id}", response_model=DrugOut, summary="Partially update a drug")
def update_drug(
    drugbank_id: str,
    payload: DrugUpdate,
    db: Session = Depends(get_db),
):
    drug = db.query(Drug).filter(Drug.drugbank_id == drugbank_id.upper()).first()
    if not drug:
        raise HTTPException(status_code=404, detail=f"Drug '{drugbank_id}' not found")

    update_data = payload.model_dump(exclude_unset=True)
    field_map = {
        "drug_groups": "_drug_groups_raw",
        "categories": "_categories_json",
        "aliases": "_aliases_json",
        "chemical_properties": "_chemical_properties_json",
        "external_mappings": "_external_mappings_json",
    }
    for key, value in update_data.items():
        mapped = field_map.get(key, key)
        setattr(drug, mapped, value)

    db.commit()
    db.refresh(drug)
    cache_delete(f"drugs:detail:{drugbank_id.upper()}")
    cache_delete_prefix("drugs:list:")
    return DrugOut.model_validate(drug)


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete(
    "/{drugbank_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a drug",
)
def delete_drug(drugbank_id: str, db: Session = Depends(get_db)):
    drug = db.query(Drug).filter(Drug.drugbank_id == drugbank_id.upper()).first()
    if not drug:
        raise HTTPException(status_code=404, detail=f"Drug '{drugbank_id}' not found")
    db.delete(drug)
    db.commit()
    cache_delete(f"drugs:detail:{drugbank_id.upper()}")
    cache_delete_prefix("drugs:list:")
