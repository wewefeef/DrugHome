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
from app.models import Drug, DrugProteinInteraction, Protein, DrugInteraction
from app.schemas import DrugCreate, DrugOut, DrugUpdate, PaginatedResponse
from app.core.simple_cache import cache_get, cache_set, cache_delete, cache_delete_prefix


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
CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "pain":        ["Analgesic", "Antipyretic", "Anti-Inflammatory", "Opioid", "Migraine", "Nonsteroidal"],
    "cardio":      ["Cardiovascular", "Antihypertensive", "Antiarrhythmic", "Vasodilator", "Anticoagulant", "Antiplatelet", "Cardiac", "Diuretic"],
    "antibiotics": ["Anti-Bacterial", "Antibiotic", "Antimicrobial", "Anti-Infective", "Bactericidal"],
    "cns":         ["Central Nervous System", "Antidepressant", "Antipsychotic", "Anxiolytic", "Sedative", "Hypnotic", "Stimulant"],
    "diabetes":    ["Hypoglycemic", "Antidiabetic", "Insulin", "Endocrine", "Hormones"],
    "neuro":       ["Anticonvulsant", "Parkinson", "Alzheimer", "Multiple Sclerosis", "Neuropathy", "Neurology"],
    "oncology":    ["Antineoplastic", "Chemotherapy", "Cancer", "Immunotherapy", "Cytotoxic"],
    "gi":          ["Gastrointestinal", "Antacid", "Proton Pump", "Laxative", "Antiemetic", "Digestive"],
    "immuno":      ["Immunosuppressive", "Immunomodulatory", "Autoimmune", "Antibodies", "Monoclonal"],
    "antiviral":   ["Antiviral", "Antifungal", "Antiparasitic", "HIV", "Hepatitis", "Antiretroviral"],
    "cholesterol": ["Lipid", "Statin", "Cholesterol", "Fibrate", "Antilipemic"],
    "respiratory": ["Respiratory", "Bronchodilator", "Antiasthmatic", "Expectorant", "Antitussive"],
    "rheuma":      ["Rheumatoid", "Anti-Rheumatic", "Gout", "Bone", "Arthritis", "NSAID"],
}

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
        g = group.strip()
        qs = qs.filter(
            or_(
                Drug._drug_groups_raw.like(f"{g}|%"),
                Drug._drug_groups_raw.like(f"%|{g}|%"),
                Drug._drug_groups_raw.like(f"%|{g}"),
                Drug._drug_groups_raw == g,
            )
        )

    if category_key.strip() and category_key.strip() in CATEGORY_KEYWORDS:
        keywords = CATEGORY_KEYWORDS[category_key.strip()]
        cat_filters = [
            text("CAST(categories AS CHAR) LIKE :ck_" + str(i)).bindparams(**{"ck_" + str(i): f"%{kw}%"})
            for i, kw in enumerate(keywords)
        ]
        qs = qs.filter(or_(*cat_filters))

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

    keywords = CATEGORY_KEYWORDS[category_key]
    cat_filters = [
        text("CAST(categories AS CHAR) LIKE :ck_" + str(i)).bindparams(**{"ck_" + str(i): f"%{kw}%"})
        for i, kw in enumerate(keywords)
    ]
    qs = db.query(Drug).filter(or_(*cat_filters))

    if has_network:
        # Only include drugs that have at least 1 protein interaction record
        # NOTE: drug_protein_interactions uses drug_code (DR:XXXXX), NOT drug_drugbank_id
        qs = qs.join(
            DrugProteinInteraction,
            Drug.drug_code == DrugProteinInteraction.drug_code,
        ).distinct()

    total = qs.count()
    offset = (page - 1) * per_page
    drugs = qs.order_by(Drug.name).offset(offset).limit(per_page).all()

    # Compute protein counts for all returned drugs
    # Map drug_code → drugbank_id for result assembly
    code_to_dbid = {d.drug_code: d.drugbank_id for d in drugs}
    drug_codes = list(code_to_dbid.keys())
    counts_map: dict[str, dict[str, int]] = {}
    if drug_codes:
        count_rows = (
            db.query(
                DrugProteinInteraction.drug_code,
                DrugProteinInteraction.interaction_type,
                sqlfunc.count(DrugProteinInteraction.id).label("cnt"),
            )
            .filter(DrugProteinInteraction.drug_code.in_(drug_codes))
            .group_by(DrugProteinInteraction.drug_code, DrugProteinInteraction.interaction_type)
            .all()
        )
        for code, itype, cnt in count_rows:
            dbid = code_to_dbid.get(code)
            if dbid:
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

    # NOTE: drug_protein_interactions and drug_interactions use drug_code (DR:XXXXX),
    # NOT drug_drugbank_id — must use drug.drug_code for the filter.

    # Protein interactions with protein details
    protein_rels = (
        db.query(DrugProteinInteraction, Protein)
        .join(Protein, DrugProteinInteraction.protein_id == Protein.id)
        .filter(DrugProteinInteraction.drug_code == drug.drug_code)
        .all()
    )

    # Drug-drug interactions
    drug_rels = (
        db.query(DrugInteraction)
        .filter(DrugInteraction.drug_code == drug.drug_code)
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
    cache_set(cache_key, result, ttl=300)
    return result


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
    # Compute protein interaction counts by type — filter by drug_code, NOT drug_drugbank_id
    counts = (
        db.query(DrugProteinInteraction.interaction_type, sqlfunc.count(DrugProteinInteraction.id))
        .filter(DrugProteinInteraction.drug_code == drug.drug_code)
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
