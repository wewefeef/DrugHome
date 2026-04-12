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
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Drug
from app.schemas import DrugCreate, DrugOut, DrugUpdate, PaginatedResponse

router = APIRouter(prefix="/api/v1/drugs", tags=["Drugs"])


# ── Read: list ────────────────────────────────────────────────────────────────

@router.get("/", response_model=PaginatedResponse, summary="List / search drugs")
def list_drugs(
    q: str = Query(default="", description="Search by name, DrugBank ID, or CAS"),
    drug_type: str = Query(default="", description="Filter: small molecule | biotech"),
    state: str = Query(default="", description="Filter: solid | liquid | gas"),
    group: str = Query(default="", description="Filter by group e.g. approved"),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=500),
    db: Session = Depends(get_db),
):
    qs = db.query(Drug)

    if q.strip():
        query = q.strip()
        id_match = re.search(r"(DB\d{4,})", query, re.IGNORECASE)
        filters = [
            Drug.name.ilike(f"%{query}%"),
            Drug.drugbank_id.ilike(f"%{query}%"),
            Drug.cas_number.ilike(f"%{query}%"),
        ]
        if id_match:
            filters.append(Drug.drugbank_id == id_match.group(1).upper())
        qs = qs.filter(or_(*filters))

    if drug_type.strip():
        qs = qs.filter(Drug.drug_type == drug_type.strip())

    if state.strip():
        qs = qs.filter(Drug.state == state.strip())

    if group.strip():
        qs = qs.filter(Drug._drug_groups_raw.ilike(f"%{group.strip()}%"))

    total = qs.count()
    offset = (page - 1) * per_page
    drugs = qs.order_by(Drug.name).offset(offset).limit(per_page).all()

    items = [DrugOut.model_validate(d) for d in drugs]

    return PaginatedResponse(
        total=total,
        page=page,
        per_page=per_page,
        total_pages=ceil(total / per_page) if total else 0,
        items=items,
    )


# ── Read: single ──────────────────────────────────────────────────────────────

@router.get("/{drugbank_id}", response_model=DrugOut, summary="Get a single drug")
def get_drug(drugbank_id: str, db: Session = Depends(get_db)):
    drug = (
        db.query(Drug)
        .filter(Drug.drugbank_id == drugbank_id.upper())
        .first()
    )
    if not drug:
        raise HTTPException(status_code=404, detail=f"Drug '{drugbank_id}' not found")
    return DrugOut.model_validate(drug)


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
