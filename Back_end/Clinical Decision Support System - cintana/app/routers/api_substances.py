"""
Protein / Active Substance CRUD API
=====================================
RESTful endpoints for managing proteins (targets, enzymes, transporters, carriers).

Routes
------
GET    /api/v1/substances/       → list & search proteins (paginated)
GET    /api/v1/substances/{id}   → get one protein
POST   /api/v1/substances/       → create a new protein
PATCH  /api/v1/substances/{id}   → partial update
DELETE /api/v1/substances/{id}   → delete
GET    /api/v1/substances/{id}/drugs  → list drugs that interact with this protein
"""

from __future__ import annotations

from math import ceil
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Drug, DrugProteinInteraction, Protein
from app.schemas import (
    DrugOut,
    PaginatedResponse,
    ProteinCreate,
    ProteinOut,
    ProteinUpdate,
)

router = APIRouter(prefix="/api/v1/substances", tags=["Substances (Proteins)"])


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("/", response_model=PaginatedResponse, summary="List / search proteins")
def list_proteins(
    q: str = Query(default="", description="Search by name, gene name, or UniProt ID"),
    protein_type: str = Query(
        default="", description="Filter: target | enzyme | transporter | carrier"
    ),
    organism: str = Query(default="", description="Filter by organism e.g. Humans"),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=200),
    db: Session = Depends(get_db),
):
    qs = db.query(Protein)

    if q.strip():
        query = q.strip()
        qs = qs.filter(
            Protein.name.ilike(f"%{query}%")
            | Protein.gene_name.ilike(f"%{query}%")
            | Protein.uniprot_id.ilike(f"%{query}%")
        )

    if protein_type.strip():
        qs = qs.filter(Protein.protein_type == protein_type.strip())

    if organism.strip():
        qs = qs.filter(Protein.organism.ilike(f"%{organism.strip()}%"))

    total = qs.count()
    offset = (page - 1) * per_page
    proteins = qs.order_by(Protein.name).offset(offset).limit(per_page).all()

    return PaginatedResponse(
        total=total,
        page=page,
        per_page=per_page,
        total_pages=ceil(total / per_page) if total else 0,
        items=[ProteinOut.model_validate(p) for p in proteins],
    )


# ── Get one ───────────────────────────────────────────────────────────────────

@router.get("/{protein_id}", response_model=ProteinOut, summary="Get a protein by ID")
def get_protein(protein_id: int, db: Session = Depends(get_db)):
    protein = db.query(Protein).filter(Protein.id == protein_id).first()
    if not protein:
        raise HTTPException(status_code=404, detail=f"Protein #{protein_id} not found")
    return ProteinOut.model_validate(protein)


# ── Create ────────────────────────────────────────────────────────────────────

@router.post(
    "/",
    response_model=ProteinOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new protein",
)
def create_protein(payload: ProteinCreate, db: Session = Depends(get_db)):
    if payload.uniprot_id:
        existing = (
            db.query(Protein).filter(Protein.uniprot_id == payload.uniprot_id).first()
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"UniProt ID '{payload.uniprot_id}' already exists (protein #{existing.id})",
            )

    protein = Protein(**payload.model_dump())
    db.add(protein)
    db.commit()
    db.refresh(protein)
    return ProteinOut.model_validate(protein)


# ── Update ────────────────────────────────────────────────────────────────────

@router.patch(
    "/{protein_id}", response_model=ProteinOut, summary="Partially update a protein"
)
def update_protein(
    protein_id: int, payload: ProteinUpdate, db: Session = Depends(get_db)
):
    protein = db.query(Protein).filter(Protein.id == protein_id).first()
    if not protein:
        raise HTTPException(status_code=404, detail=f"Protein #{protein_id} not found")

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(protein, key, value)

    db.commit()
    db.refresh(protein)
    return ProteinOut.model_validate(protein)


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete(
    "/{protein_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a protein",
)
def delete_protein(protein_id: int, db: Session = Depends(get_db)):
    protein = db.query(Protein).filter(Protein.id == protein_id).first()
    if not protein:
        raise HTTPException(status_code=404, detail=f"Protein #{protein_id} not found")
    db.delete(protein)
    db.commit()


# ── Drugs that bind this protein ──────────────────────────────────────────────

@router.get(
    "/{protein_id}/drugs",
    response_model=PaginatedResponse,
    summary="List drugs interacting with this protein",
)
def get_drugs_for_protein(
    protein_id: int,
    interaction_type: str = Query(
        default="", description="Filter: target | enzyme | transporter | carrier"
    ),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=200),
    db: Session = Depends(get_db),
):
    # Validate protein exists
    if not db.query(Protein).filter(Protein.id == protein_id).first():
        raise HTTPException(status_code=404, detail=f"Protein #{protein_id} not found")

    qs = (
        db.query(Drug)
        .join(
            DrugProteinInteraction,
            DrugProteinInteraction.drug_code == Drug.drug_code,
        )
        .filter(DrugProteinInteraction.protein_id == protein_id)
    )

    if interaction_type.strip():
        qs = qs.filter(
            DrugProteinInteraction.interaction_type == interaction_type.strip()
        )

    total = qs.count()
    offset = (page - 1) * per_page
    drugs = qs.order_by(Drug.name).offset(offset).limit(per_page).all()

    return PaginatedResponse(
        total=total,
        page=page,
        per_page=per_page,
        total_pages=ceil(total / per_page) if total else 0,
        items=[DrugOut.model_validate(d) for d in drugs],
    )
