"""
Drug Interaction CRUD API
=========================
RESTful endpoints for managing drug-drug interactions.

Routes
------
GET    /api/v1/interactions/            → list interactions (filterable & paginated)
GET    /api/v1/interactions/{id}        → get one interaction
GET    /api/v1/interactions/drug/{drugbank_id}  → get all interactions for a drug
POST   /api/v1/interactions/            → create interaction
PATCH  /api/v1/interactions/{id}        → partial update
DELETE /api/v1/interactions/{id}        → delete
"""

from __future__ import annotations

from math import ceil
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Drug, DrugInteraction
from app.schemas import (
    InteractionCreate,
    InteractionOut,
    InteractionUpdate,
    PaginatedResponse,
)

router = APIRouter(prefix="/api/v1/interactions", tags=["Drug Interactions"])


# ── List all ──────────────────────────────────────────────────────────────────

@router.get("/", response_model=PaginatedResponse, summary="List/filter interactions")
def list_interactions(
    severity: str = Query(default="", description="major | moderate | minor | unknown"),
    drug_id: str = Query(default="", description="Filter by source drug DrugBank ID (e.g. DB00001)"),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=200),
    db: Session = Depends(get_db),
):
    qs = db.query(DrugInteraction)

    if severity.strip():
        qs = qs.filter(DrugInteraction.severity == severity.strip().lower())

    if drug_id.strip():
        qs = qs.filter(DrugInteraction.drug_id == drug_id.strip().upper())

    total = qs.count()
    offset = (page - 1) * per_page
    # ix_di_drug_severity covers (drug_id, severity)
    rows = qs.order_by(DrugInteraction.severity, DrugInteraction.id).offset(offset).limit(per_page).all()

    return PaginatedResponse(
        total=total,
        page=page,
        per_page=per_page,
        total_pages=ceil(total / per_page) if total else 0,
        items=[InteractionOut.model_validate(r) for r in rows],
    )


# ── All interactions for a specific drug ──────────────────────────────────────

@router.get(
    "/drug/{drugbank_id}",
    response_model=PaginatedResponse,
    summary="Get all interactions for a drug",
)
def get_interactions_for_drug(
    drugbank_id: str,
    severity: str = Query(default=""),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    drug = (
        db.query(Drug)
        .filter(Drug.drugbank_id == drugbank_id.upper())
        .first()
    )
    if not drug:
        raise HTTPException(status_code=404, detail=f"Drug '{drugbank_id}' not found")

    dbid = drug.drugbank_id

    # ix_di_drug_severity covers (drug_id, severity)
    # ix_di_interacting covers interacting_drug_id
    qs = db.query(DrugInteraction).filter(
        or_(
            DrugInteraction.drug_id == dbid,
            DrugInteraction.interacting_drug_id == dbid,
        )
    )

    if severity.strip():
        qs = qs.filter(DrugInteraction.severity == severity.strip().lower())

    total = qs.count()
    offset = (page - 1) * per_page
    rows = qs.order_by(DrugInteraction.severity).offset(offset).limit(per_page).all()

    return PaginatedResponse(
        total=total,
        page=page,
        per_page=per_page,
        total_pages=ceil(total / per_page) if total else 0,
        items=[InteractionOut.model_validate(r) for r in rows],
    )


# ── Get one ───────────────────────────────────────────────────────────────────

@router.get(
    "/{interaction_id}",
    response_model=InteractionOut,
    summary="Get a single interaction by ID",
)
def get_interaction(interaction_id: int, db: Session = Depends(get_db)):
    row = db.query(DrugInteraction).filter(DrugInteraction.id == interaction_id).first()
    if not row:
        raise HTTPException(
            status_code=404, detail=f"Interaction #{interaction_id} not found"
        )
    return InteractionOut.model_validate(row)


# ── Create ────────────────────────────────────────────────────────────────────

@router.post(
    "/",
    response_model=InteractionOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new drug interaction",
)
def create_interaction(payload: InteractionCreate, db: Session = Depends(get_db)):
    # Validate that the source drug exists
    drug = (
        db.query(Drug).filter(Drug.drugbank_id == payload.drug_id.upper()).first()
    )
    if not drug:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Source drug '{payload.drug_id}' not found",
        )

    # Check for duplicate
    existing = (
        db.query(DrugInteraction)
        .filter(
            DrugInteraction.drug_id == payload.drug_id.upper(),
            DrugInteraction.interacting_drug_id == payload.interacting_drug_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Interaction between '{payload.drug_id}' and "
                f"'{payload.interacting_drug_id}' already exists (id={existing.id})"
            ),
        )

    row = DrugInteraction(
        drug_id=payload.drug_id.upper(),
        interacting_drug_id=payload.interacting_drug_id,
        interacting_drug_name=payload.interacting_drug_name,
        severity=payload.severity.value if payload.severity else "unknown",
        description=payload.description,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return InteractionOut.model_validate(row)


# ── Update ────────────────────────────────────────────────────────────────────

@router.patch(
    "/{interaction_id}",
    response_model=InteractionOut,
    summary="Partially update an interaction",
)
def update_interaction(
    interaction_id: int,
    payload: InteractionUpdate,
    db: Session = Depends(get_db),
):
    row = db.query(DrugInteraction).filter(DrugInteraction.id == interaction_id).first()
    if not row:
        raise HTTPException(
            status_code=404, detail=f"Interaction #{interaction_id} not found"
        )

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if key == "severity" and value is not None:
            value = value.value
        setattr(row, key, value)

    db.commit()
    db.refresh(row)
    return InteractionOut.model_validate(row)


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete(
    "/{interaction_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an interaction",
)
def delete_interaction(interaction_id: int, db: Session = Depends(get_db)):
    row = db.query(DrugInteraction).filter(DrugInteraction.id == interaction_id).first()
    if not row:
        raise HTTPException(
            status_code=404, detail=f"Interaction #{interaction_id} not found"
        )
    db.delete(row)
    db.commit()
