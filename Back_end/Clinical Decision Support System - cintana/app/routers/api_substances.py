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

import re
from math import ceil
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func as sqlfunc, or_, text
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
from app.core.simple_cache import cache_get, cache_set, cache_delete, cache_delete_prefix


def _build_fulltext_query(raw: str) -> str:
    """Convert user input to MySQL boolean FULLTEXT format."""
    words = raw.strip().split()
    parts = []
    for w in words:
        w = re.sub(r'[+\-><()\~*"@]', '', w)
        if not w:
            continue
        parts.append(f"+{w}*" if len(w) >= 3 else w)
    return " ".join(parts) if parts else raw

router = APIRouter(prefix="/api/v1/substances", tags=["Substances (Proteins)"])


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("", response_model=PaginatedResponse, summary="List / search proteins")
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
    cache_key = f"proteins:list:{q}:{protein_type}:{organism}:{page}:{per_page}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    qs = db.query(Protein)

    if q.strip():
        query = q.strip()

        # Check for exact UniProt ID (e.g. "P12345")
        if re.match(r'^[A-Z]\d{5}([A-Z]\d)?$', query, re.IGNORECASE):
            qs = qs.filter(Protein.uniprot_id == query.upper())
        elif len(query) >= 3:
            # FULLTEXT on composite index ix_proteins_name_gene_ft
            # MATCH covers both name AND gene_name columns simultaneously
            ft_q = _build_fulltext_query(query)
            qs = qs.filter(
                or_(
                    text("MATCH(name, gene_name) AGAINST(:ft_q IN BOOLEAN MODE)"),
                    # Fallback: UniProt ID prefix
                    Protein.uniprot_id.like(f"{query.upper()}%"),
                )
            ).params(ft_q=ft_q)
        else:
            qs = qs.filter(
                or_(
                    Protein.name.like(f"{query}%"),
                    Protein.gene_name.like(f"{query}%"),
                    Protein.uniprot_id.like(f"{query.upper()}%"),
                )
            )

    if protein_type.strip():
        qs = qs.filter(Protein.protein_type == protein_type.strip())

    if organism.strip():
        # prefix match — hits ix_proteins_organism index
        qs = qs.filter(Protein.organism.like(f"{organism.strip()}%"))

    total = qs.count()
    offset = (page - 1) * per_page
    proteins = qs.order_by(Protein.name).offset(offset).limit(per_page).all()

    # Compute drug_count and actions for each protein in two separate batch queries
    protein_ids = [p.id for p in proteins]
    drug_counts: dict[int, int] = {}
    protein_actions: dict[int, list[str]] = {}
    if protein_ids:
        # Query 1: correct drug count — group only by protein_id
        count_rows = (
            db.query(
                DrugProteinInteraction.protein_id,
                sqlfunc.count(sqlfunc.distinct(DrugProteinInteraction.drug_id)).label("drug_count"),
            )
            .filter(DrugProteinInteraction.protein_id.in_(protein_ids))
            .group_by(DrugProteinInteraction.protein_id)
            .all()
        )
        for pid, cnt in count_rows:
            drug_counts[pid] = cnt

        # Query 2: collect unique action arrays per protein
        action_rows = (
            db.query(
                DrugProteinInteraction.protein_id,
                DrugProteinInteraction.actions,
            )
            .filter(DrugProteinInteraction.protein_id.in_(protein_ids))
            .distinct()
            .all()
        )
        for pid, acts in action_rows:
            if acts and isinstance(acts, list):
                existing = protein_actions.get(pid, [])
                for a in acts:
                    if a and a not in existing:
                        existing.append(a)
                protein_actions[pid] = existing

    items = []
    for p in proteins:
        out = ProteinOut.model_validate(p)
        out.drug_count = drug_counts.get(p.id, 0)
        out.actions = protein_actions.get(p.id, [])
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


# ── Get one ───────────────────────────────────────────────────────────────────

@router.get("/{protein_id}", response_model=ProteinOut, summary="Get a protein by ID")
def get_protein(protein_id: int, db: Session = Depends(get_db)):
    detail_key = f"proteins:detail:{protein_id}"
    cached = cache_get(detail_key)
    if cached is not None:
        return cached

    protein = db.query(Protein).filter(Protein.id == protein_id).first()
    if not protein:
        raise HTTPException(status_code=404, detail=f"Protein #{protein_id} not found")
    out = ProteinOut.model_validate(protein)
    # Correct drug count — count distinct drug_id
    total_drugs = (
        db.query(sqlfunc.count(sqlfunc.distinct(DrugProteinInteraction.drug_id)))
        .filter(DrugProteinInteraction.protein_id == protein_id)
        .scalar()
    ) or 0
    # Collect unique actions separately
    action_rows = (
        db.query(DrugProteinInteraction.actions)
        .filter(DrugProteinInteraction.protein_id == protein_id)
        .distinct()
        .all()
    )
    all_actions: list[str] = []
    for (acts,) in action_rows:
        if acts and isinstance(acts, list):
            for a in acts:
                if a and a not in all_actions:
                    all_actions.append(a)
    out.drug_count = total_drugs
    out.actions = all_actions
    cache_set(detail_key, out, ttl=600)
    return out


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
    cache_delete_prefix("proteins:list:")
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
    cache_delete(f"proteins:detail:{protein_id}")
    cache_delete_prefix("proteins:list:")
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
    cache_delete(f"proteins:detail:{protein_id}")
    cache_delete_prefix("proteins:list:")


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
            DrugProteinInteraction.drug_id == Drug.drugbank_id,
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
