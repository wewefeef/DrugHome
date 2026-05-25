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

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import or_, text
from sqlalchemy.orm import Session

from sqlalchemy import func as sqlfunc

from app.database import get_db
from app.models import (
    Drug, DrugProteinInteraction, Protein, DrugInteraction,
    DrugGroup, DrugGroupMap, DrugCategory, DrugCategoryMap,
    DrugFoodInteraction,
)
from app.schemas import DrugCreate, DrugOut, DrugDetailOut, DrugUpdate, PaginatedResponse
from app.core.simple_cache import cache_get, cache_set, cache_delete, cache_delete_prefix
from app.core.category_keywords import CATEGORY_KEYWORDS
from app.core import category_cache
from app.routers.api_auth import require_admin, User
from sqlalchemy.orm import selectinload


def _build_fulltext_query(raw: str) -> str:
    """Convert a user search string to MySQL boolean FULLTEXT format."""
    words = raw.strip().split()
    parts = []
    for w in words:
        w = re.sub(r'[+\-><()\~*"@]', '', w)
        if not w:
            continue
        parts.append(f"+{w}*" if len(w) >= 3 else w)
    return " ".join(parts) if parts else raw

# Disease category → MySQL LIKE keywords for the JSON categories column
# NOTE: CATEGORY_KEYWORDS is now imported from app.core.category_keywords
# (kept here for backward compatibility with any direct imports)

router = APIRouter(prefix="/api/v1/drugs", tags=["Drugs"])


# ── Read: list ────────────────────────────────────────────────────────────────

@router.get("", response_model=PaginatedResponse, summary="List / search drugs")
def list_drugs(
    q: str = Query(default="", description="Search by name, DrugBank ID, or CAS"),
    drug_type: str = Query(default="", description="Filter: small molecule | biotech"),
    state: str = Query(default="", description="Filter: solid | liquid | gas"),
    group: str = Query(default="", description="Filter by group e.g. approved"),
    category_key: str = Query(default="", description="Filter by disease category key e.g. pain | cardio"),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=500),
    db: Session = Depends(get_db),
):
    cache_key = f"drugs:list:{q}:{drug_type}:{state}:{group}:{category_key}:{page}:{per_page}"
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
        # JOIN through drug_group_map + groups — exact lookup, uses PK index
        qs = (
            qs.join(DrugGroupMap, Drug.drugbank_id == DrugGroupMap.drug_id)
            .join(DrugGroup, DrugGroupMap.group_id == DrugGroup.id)
            .filter(DrugGroup.name == group.strip())
            .distinct()
        )

    if category_key.strip() and category_key.strip() in CATEGORY_KEYWORDS:
        # Fast path: use pre-resolved category IDs (no LIKE scan on categories table)
        cat_ids = category_cache.get_ids(category_key.strip())
        if cat_ids:
            qs = (
                qs.join(DrugCategoryMap, Drug.drugbank_id == DrugCategoryMap.drug_id)
                .filter(DrugCategoryMap.category_id.in_(cat_ids))
                .distinct()
            )
        else:
            # Fallback: cache not warmed yet, use LIKE join
            keywords = CATEGORY_KEYWORDS[category_key.strip()]
            cat_filters = [
                DrugCategory.category.like(f"%{kw}%")
                for kw in keywords
            ]
            qs = (
                qs.join(DrugCategoryMap, Drug.drugbank_id == DrugCategoryMap.drug_id)
                .join(DrugCategory, DrugCategoryMap.category_id == DrugCategory.id)
                .filter(or_(*cat_filters))
                .distinct()
            )

    total = qs.count()
    offset = (page - 1) * per_page
    drugs = qs.order_by(Drug.name).offset(offset).limit(per_page).all()

    # Batch-compute protein interaction counts for all drugs on this page
    # Uses ix_dpi_drug_type (drug_id, interaction_type)
    drugbank_ids = [d.drugbank_id for d in drugs]
    counts_map: dict[str, dict[str, int]] = {}
    if drugbank_ids:
        count_rows = (
            db.query(
                DrugProteinInteraction.drug_id,
                DrugProteinInteraction.interaction_type,
                sqlfunc.count(DrugProteinInteraction.id).label("cnt"),
            )
            .filter(DrugProteinInteraction.drug_id.in_(drugbank_ids))
            .group_by(
                DrugProteinInteraction.drug_id,
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
    cache_set(cache_key, result, ttl=600)
    return result


# ── Read: single ──────────────────────────────────────────────────────────────

@router.get("/categories/{category_key}", response_model=PaginatedResponse, summary="List drugs by disease category")
def list_drugs_by_category(
    category_key: str,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=200, ge=1, le=500),
    has_network: bool = Query(default=False, description="If true, only return drugs that have protein interaction data"),
    db: Session = Depends(get_db),
):
    """Return drugs belonging to a disease category. Used by the interaction checker panel.
    When has_network=true, only drugs with at least 1 protein interaction are returned.
    """
    if category_key not in CATEGORY_KEYWORDS:
        raise HTTPException(status_code=404, detail=f"Unknown category key: {category_key}")

    cache_key = f"drugs:cat:{category_key}:{page}:{per_page}:net{has_network}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    # ── Fast path: use stored procedure when cache is warmed ──────────────────
    if has_network and category_cache.is_warmed():
        cat_ids = category_cache.get_ids(category_key)
        if cat_ids:
            cat_ids_str = ",".join(str(i) for i in cat_ids)
            limit = page * per_page  # stored proc returns from start; we slice below
            try:
                rows = db.execute(
                    text("CALL sp_category_drugs_net(:ids, :lim)"),
                    {"ids": cat_ids_str, "lim": limit},
                ).fetchall()
                total = len(rows)
                page_rows = rows[(page - 1) * per_page : page * per_page]
                items = []
                for r in page_rows:
                    out = DrugOut(
                        drugbank_id=r.drugbank_id,
                        name=r.name,
                        drug_type=None, state=None, cas_number=None,
                        description=None, indication=None, mechanism_of_action=None,
                        pharmacodynamics=None, toxicity=None, metabolism=None,
                        absorption=None, half_life=None, protein_binding=None,
                        route_of_elimination=None, groups=[], categories=[],
                        synonyms=[], external_identifiers=[], products=[],
                        average_mass=None, monoisotopic_mass=None,
                        molecular_formula=None, smiles=None, inchikey=None,
                        inchi=None, atc_codes=None, unii=None,
                    )
                    out.target_count = int(r.target_count or 0)
                    out.enzyme_count = int(r.enzyme_count or 0)
                    out.transporter_count = int(r.transporter_count or 0)
                    items.append(out)
                result = PaginatedResponse(
                    total=total, page=page, per_page=per_page,
                    total_pages=ceil(total / per_page) if total else 0,
                    items=items,
                )
                cache_set(cache_key, result, ttl=3600)
                return result
            except Exception:
                pass  # Fall through to standard ORM path on any error

    # ── Standard ORM path ─────────────────────────────────────────────────────
    cat_ids = category_cache.get_ids(category_key)
    if cat_ids:
        # Fast: IN clause on pre-resolved IDs, uses ix_dcm_cat_drug index
        qs = (
            db.query(Drug)
            .join(DrugCategoryMap, Drug.drugbank_id == DrugCategoryMap.drug_id)
            .filter(DrugCategoryMap.category_id.in_(cat_ids))
            .distinct()
        )
    else:
        # Fallback LIKE scan (cache not warmed yet)
        keywords = CATEGORY_KEYWORDS[category_key]
        cat_filters = [
            DrugCategory.category.like(f"%{kw}%")
            for kw in keywords
        ]
        qs = (
            db.query(Drug)
            .join(DrugCategoryMap, Drug.drugbank_id == DrugCategoryMap.drug_id)
            .join(DrugCategory, DrugCategoryMap.category_id == DrugCategory.id)
            .filter(or_(*cat_filters))
            .distinct()
        )

    if has_network:
        # Only include drugs that have at least 1 protein interaction record
        qs = qs.join(
            DrugProteinInteraction,
            Drug.drugbank_id == DrugProteinInteraction.drug_id,
        ).distinct()

    total = qs.count()
    offset = (page - 1) * per_page
    drugs = qs.order_by(Drug.name).offset(offset).limit(per_page).all()

    # Compute protein counts using drug_id
    drug_ids_page = [d.drugbank_id for d in drugs]
    counts_map_cat: dict[str, dict[str, int]] = {}
    if drug_ids_page:
        count_rows = (
            db.query(
                DrugProteinInteraction.drug_id,
                DrugProteinInteraction.interaction_type,
                sqlfunc.count(DrugProteinInteraction.id).label("cnt"),
            )
            .filter(DrugProteinInteraction.drug_id.in_(drug_ids_page))
            .group_by(DrugProteinInteraction.drug_id, DrugProteinInteraction.interaction_type)
            .all()
        )
        for dbid, itype, cnt in count_rows:
            counts_map_cat.setdefault(dbid, {})[itype] = cnt

    items = []
    for d in drugs:
        out = DrugOut.model_validate(d)
        c = counts_map_cat.get(d.drugbank_id, {})
        out.target_count = c.get("target", 0)
        out.enzyme_count = c.get("enzyme", 0)
        out.transporter_count = c.get("transporter", 0)
        items.append(out)

    result = PaginatedResponse(
        total=total, page=page, per_page=per_page,
        total_pages=ceil(total / per_page) if total else 0,
        items=items,
    )
    cache_set(cache_key, result, ttl=600)
    return result


@router.get("/{drugbank_id}/network", summary="Get molecular network data for a drug")
def get_drug_network(
    drugbank_id: str,
    max_interactions: int = Query(default=80, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """
    Returns nodes and edges for the molecular network graph:
    - The drug itself
    - Protein interactions (targets, enzymes, transporters, carriers) with gene info
    - Drug-drug interactions (limited by max_interactions)
    """
    cache_key = f"drugs:network:{drugbank_id.upper()}:{max_interactions}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    drug = db.query(Drug).filter(Drug.drugbank_id == drugbank_id.upper()).first()
    if not drug:
        raise HTTPException(status_code=404, detail=f"Drug '{drugbank_id}' not found")

    # Protein interactions with protein details
    protein_rels = (
        db.query(DrugProteinInteraction, Protein)
        .join(Protein, DrugProteinInteraction.protein_id == Protein.id)
        .filter(DrugProteinInteraction.drug_id == drug.drugbank_id)
        .all()
    )

    # Drug-drug interactions
    drug_rels = (
        db.query(DrugInteraction)
        .filter(DrugInteraction.drug_id == drug.drugbank_id)
        .order_by(DrugInteraction.severity)
        .limit(max_interactions)
        .all()
    )

    proteins = [
        {
            "uniprot_id": p.uniprot_id or f"P{rel.protein_id}",
            "name": p.name,
            "gene_name": p.gene_name or "",
            "type": rel.interaction_type or "target",
            "actions": rel.actions or [],
        }
        for rel, p in protein_rels
    ]

    interactions = [
        {
            "drug_id": rel.interacting_drug_id,
            "name": rel.interacting_drug_name or rel.interacting_drug_id,
            "severity": rel.severity or "unknown",
            "description": (rel.description or "")[:300],
        }
        for rel in drug_rels
    ]

    result = {
        "drug": {
            "id": drug.drugbank_id,
            "name": drug.name,
            "drug_type": drug.drug_type or "small molecule",
            "description": (drug.description or "")[:600],
            "mechanism": (drug.mechanism_of_action or "")[:600],
            "groups": drug.groups,
        },
        "proteins": proteins,
        "interactions": interactions,
        "stats": {
            "targets": sum(1 for p in proteins if p["type"] == "target"),
            "enzymes": sum(1 for p in proteins if p["type"] == "enzyme"),
            "transporters": sum(1 for p in proteins if p["type"] == "transporter"),
            "carriers": sum(1 for p in proteins if p["type"] == "carrier"),
            "drug_interactions": len(interactions),
        },
    }
    cache_set(cache_key, result, ttl=600)
    return result


@router.get("/{drugbank_id}", response_model=DrugDetailOut, summary="Get a single drug")
def get_drug(drugbank_id: str, db: Session = Depends(get_db)):
    detail_key = f"drugs:detail:{drugbank_id.upper()}"
    cached = cache_get(detail_key)
    if cached is not None:
        return cached

    drug = (
        db.query(Drug)
        .options(
            selectinload(Drug.synonyms_rel),
            selectinload(Drug.products_rel),
            selectinload(Drug.food_interactions_rel),
            selectinload(Drug.dosages_rel),
            selectinload(Drug.group_maps).selectinload(DrugGroupMap.group),
            selectinload(Drug.category_maps).selectinload(DrugCategoryMap.category),
        )
        .filter(Drug.drugbank_id == drugbank_id.upper())
        .first()
    )
    if not drug:
        raise HTTPException(status_code=404, detail=f"Drug '{drugbank_id}' not found")
    # Compute protein interaction counts by type — uses ix_dpi_drug_type index
    counts = (
        db.query(DrugProteinInteraction.interaction_type, sqlfunc.count(DrugProteinInteraction.id))
        .filter(DrugProteinInteraction.drug_id == drug.drugbank_id)
        .group_by(DrugProteinInteraction.interaction_type)
        .all()
    )
    result = DrugDetailOut.model_validate(drug)
    for itype, cnt in counts:
        if itype == "target":
            result.target_count = cnt
        elif itype == "enzyme":
            result.enzyme_count = cnt
        elif itype == "transporter":
            result.transporter_count = cnt
    # Load brand names (products) — sorted by name, deduplicated by (name, labeller)
    seen = set()
    products_out = []
    for p in sorted(drug.products_rel, key=lambda x: (x.name or "", x.labeller or "")):
        key = (p.name or "").lower().strip(), (p.labeller or "").lower().strip()
        if key in seen:
            continue
        seen.add(key)
        products_out.append(
            {"id": p.id, "name": p.name, "labeller": p.labeller,
             "dosage_form": p.dosage_form, "strength": p.strength,
             "route": p.route, "country": p.country, "source": p.source}
        )
    result.products = products_out
    # Load food interactions
    result.food_interactions = [
        {"id": fi.id, "interaction": fi.interaction}
        for fi in drug.food_interactions_rel
    ]
    # Load dosages — deduplicated by (form, route, strength)
    seen_dos: set = set()
    dosages_out = []
    for dos in drug.dosages_rel:
        key = ((dos.form or "").lower(), (dos.route or "").lower(), (dos.strength or "").lower())
        if key in seen_dos:
            continue
        seen_dos.add(key)
        dosages_out.append({"id": dos.id, "form": dos.form, "route": dos.route, "strength": dos.strength})
    result.dosages = dosages_out
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
    # Uniqueness check
    if db.query(Drug).filter(Drug.drugbank_id == payload.drugbank_id.upper()).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"DrugBank ID '{payload.drugbank_id}' already exists",
        )

    drug = Drug(
        drugbank_id=payload.drugbank_id.upper(),
        name=payload.name,
        drug_type=payload.drug_type,
        atc_codes=payload.atc_codes,
        inchikey=payload.inchikey,
        cas_number=payload.cas_number,
        unii=payload.unii,
        state=payload.state,
        smiles=payload.smiles,
        molecular_formula=payload.molecular_formula,
        average_mass=payload.average_mass,
        monoisotopic_mass=payload.monoisotopic_mass,
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
    )
    db.add(drug)
    db.flush()  # get drugbank_id into session before adding mappings

    # Handle groups
    if payload.groups:
        from app.models import DrugGroup, DrugGroupMap
        for gname in payload.groups:
            grp = db.query(DrugGroup).filter(DrugGroup.name == gname).first()
            if not grp:
                grp = DrugGroup(name=gname)
                db.add(grp)
                db.flush()
            db.add(DrugGroupMap(drug_id=drug.drugbank_id, group_id=grp.id))

    # Handle categories
    if payload.categories:
        from app.models import DrugCategory, DrugCategoryMap
        for cname in payload.categories:
            cat = db.query(DrugCategory).filter(DrugCategory.category == cname).first()
            if not cat:
                cat = DrugCategory(category=cname)
                db.add(cat)
                db.flush()
            db.add(DrugCategoryMap(drug_id=drug.drugbank_id, category_id=cat.id))

    # Handle synonyms
    if payload.synonyms:
        from app.models import DrugSynonym
        for syn in payload.synonyms:
            db.add(DrugSynonym(drug_id=drug.drugbank_id, synonym=syn))

    db.commit()
    db.refresh(drug)
    cache_delete_prefix("drugs:list:")

    # ── Feedback 2: Backfill interacting_drug_name trong drug_interactions ────
    # Khi thuốc mới được thêm vào, có thể đã có hàng nghìn rows trong
    # drug_interactions với interacting_drug_id = drugbank_id nhưng
    # interacting_drug_name = NULL (vì thuốc chưa tồn tại lúc import).
    # Cập nhật tên ngay sau khi tạo để dữ liệu nhất quán.
    try:
        backfill_count = (
            db.query(DrugInteraction)
            .filter(
                DrugInteraction.interacting_drug_id == drug.drugbank_id,
                DrugInteraction.interacting_drug_name.is_(None),
            )
            .update(
                {DrugInteraction.interacting_drug_name: drug.name},
                synchronize_session=False,
            )
        )
        if backfill_count:
            db.commit()
            import logging
            logging.getLogger(__name__).info(
                "Backfilled interacting_drug_name='%s' for %d interaction rows (interacting_drug_id=%s)",
                drug.name, backfill_count, drug.drugbank_id,
            )
    except Exception:
        db.rollback()  # backfill thất bại không ảnh hưởng đến việc tạo thuốc

    return DrugOut.model_validate(drug)


# ── Update ────────────────────────────────────────────────────────────────────

@router.patch("/{drugbank_id}", response_model=DrugOut, summary="Partially update a drug")
def update_drug(
    drugbank_id: str,
    payload: DrugUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    drug = db.query(Drug).filter(Drug.drugbank_id == drugbank_id.upper()).first()
    if not drug:
        raise HTTPException(status_code=404, detail=f"Drug '{drugbank_id}' not found")

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(drug, key, value)

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


# ── Food Interactions ─────────────────────────────────────────────────────────


class FoodInteractionsBatchRequest(BaseModel):
    drug_ids: List[str]


@router.get(
    "/{drugbank_id}/food-interactions",
    summary="Get food interactions for a drug",
)
def get_food_interactions(drugbank_id: str, db: Session = Depends(get_db)):
    """Return all food/drink interaction warnings for a single drug."""
    drug = db.query(Drug).filter(Drug.drugbank_id == drugbank_id.upper()).first()
    if not drug:
        raise HTTPException(status_code=404, detail=f"Drug '{drugbank_id}' not found")

    interactions = (
        db.query(DrugFoodInteraction)
        .filter(DrugFoodInteraction.drug_id == drug.drugbank_id)
        .all()
    )

    return {
        "drugbank_id": drug.drugbank_id,
        "drug_name": drug.name,
        "food_interactions": [
            {"id": fi.id, "interaction": fi.interaction}
            for fi in interactions
        ],
        "total": len(interactions),
    }


@router.post(
    "/food-interactions-batch",
    summary="Get food interactions for multiple drugs",
)
def get_food_interactions_batch(
    payload: FoodInteractionsBatchRequest,
    db: Session = Depends(get_db),
):
    """Return food/drink interaction warnings for multiple drugs at once."""
    if not payload.drug_ids:
        return {"results": [], "total_drugs": 0}

    # Normalize IDs
    drug_ids = [did.upper() for did in payload.drug_ids[:50]]  # limit to 50

    # Fetch drugs
    drugs = (
        db.query(Drug)
        .filter(Drug.drugbank_id.in_(drug_ids))
        .all()
    )
    drug_map = {d.drugbank_id: d.name for d in drugs}

    # Fetch all food interactions for these drugs in one query
    interactions = (
        db.query(DrugFoodInteraction)
        .filter(DrugFoodInteraction.drug_id.in_(drug_ids))
        .all()
    )

    # Group by drug_id
    grouped: dict[str, list] = {did: [] for did in drug_ids if did in drug_map}
    for fi in interactions:
        if fi.drug_id in grouped:
            grouped[fi.drug_id].append({"id": fi.id, "interaction": fi.interaction})

    results = []
    for did in drug_ids:
        if did not in drug_map:
            continue
        fi_list = grouped.get(did, [])
        results.append({
            "drugbank_id": did,
            "drug_name": drug_map[did],
            "food_interactions": fi_list,
            "total": len(fi_list),
        })

    return {"results": results, "total_drugs": len(results)}
