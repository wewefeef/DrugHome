"""
Drug Wizard Router
==================
Serves the 3-step "Add New Drug" wizard at /admin/wizard/drug/new
and backing API endpoints for validation / autocomplete / save.

Routes:
  GET  /admin/wizard/drug/new          → Wizard HTML page
  GET  /api/v1/wizard/check-id         → Check duplicate DrugBank ID
  GET  /api/v1/wizard/search-proteins  → Protein autocomplete
  GET  /api/v1/wizard/search-drugs     → Drug autocomplete (for interactions step)
  GET  /api/v1/wizard/search-categories → Category autocomplete
  GET  /api/v1/wizard/groups           → All approval groups
  POST /api/v1/wizard/save-drug        → Save complete drug (all 3 steps atomically)
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from sqlalchemy import or_, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    Drug, DrugSynonym, DrugProduct, DrugExternalIdentifier,
    DrugGroupMap, DrugCategoryMap, DrugProteinInteraction,
    DrugInteraction, DrugGroup, DrugCategory, Protein,
)
from app.core.simple_cache import cache_delete_prefix, cache_delete

router = APIRouter(tags=["Drug Wizard"])

WIZARD_HTML = Path(__file__).resolve().parent.parent / "templates" / "wizard_drug.html"


# ── Wizard HTML page ──────────────────────────────────────────────────────────
# Đọc file HTML trực tiếp thay vì dùng Jinja2Templates để tránh lỗi Jinja2
# parse JS curly-brace syntax trong template.

@router.get("/drug-wizard/new", response_class=HTMLResponse, include_in_schema=False)
def wizard_page():
    """Serve the 3-step Add Drug Wizard UI — raw HTML, no Jinja2."""
    html = WIZARD_HTML.read_text(encoding="utf-8")
    return HTMLResponse(content=html)


# ── Validation & autocomplete APIs ───────────────────────────────────────────

@router.get("/api/v1/wizard/check-id")
def check_id(drugbank_id: str = Query(...), db: Session = Depends(get_db)):
    """Return {exists: bool, name?: str} for duplicate check."""
    d = db.query(Drug).filter(Drug.drugbank_id == drugbank_id.upper().strip()).first()
    if d:
        return {"exists": True, "name": d.name}
    return {"exists": False}


@router.get("/api/v1/wizard/search-proteins")
def search_proteins(q: str = Query(default=""), db: Session = Depends(get_db)):
    """Autocomplete proteins by uniprot_id or name (for step 3)."""
    q = q.strip()
    if not q:
        return {"items": []}
    qs = db.query(Protein).filter(
        or_(
            Protein.uniprot_id.like(f"{q.upper()}%"),
            Protein.name.like(f"%{q}%"),
            Protein.gene_name.like(f"%{q}%"),
        )
    ).limit(10).all()
    return {"items": [
        {"id": p.id, "uniprot_id": p.uniprot_id or "", "name": p.name, "gene_name": p.gene_name or ""}
        for p in qs
    ]}


@router.get("/api/v1/wizard/search-drugs")
def search_drugs(q: str = Query(default=""), db: Session = Depends(get_db)):
    """Autocomplete drugs by name or ID (for drug-drug interaction step)."""
    q = q.strip()
    if not q:
        return {"items": []}
    qs = db.query(Drug).filter(
        or_(
            Drug.name.like(f"%{q}%"),
            Drug.drugbank_id.like(f"{q.upper()}%"),
        )
    ).limit(10).all()
    return {"items": [{"id": d.drugbank_id, "name": d.name} for d in qs]}


@router.get("/api/v1/wizard/search-categories")
def search_categories(q: str = Query(default=""), db: Session = Depends(get_db)):
    """Autocomplete DrugCategory for step 3."""
    q = q.strip()
    if not q:
        return {"items": []}
    qs = db.query(DrugCategory).filter(
        DrugCategory.category.like(f"%{q}%")
    ).limit(12).all()
    return {"items": [{"id": c.id, "category": c.category} for c in qs]}


@router.get("/api/v1/wizard/groups")
def get_groups(db: Session = Depends(get_db)):
    """Return all approval groups."""
    groups = db.query(DrugGroup).order_by(DrugGroup.name).all()
    return {"items": [{"id": g.id, "name": g.name} for g in groups]}


# ── Save entire drug (atomic) ─────────────────────────────────────────────────

@router.post("/api/v1/wizard/save-drug")
def save_drug(request_data: dict = Body(...), db: Session = Depends(get_db)):
    """
    Atomically insert Drug + all related rows from 3 wizard steps.
    request_data shape:
    {
      // Step 1
      drugbank_id, name, drug_type, state, average_mass,
      mechanism_of_action, indication, toxicity,
      // Step 2
      synonyms:   [{synonym, language}],
      products:   [{name, labeller, dosage_form, strength, route, country}],
      ext_ids:    [{resource, identifier}],
      // Step 3
      group_ids:  [int],
      category_ids: [int],
      protein_interactions: [{protein_id, interaction_type, known_action, actions:[]}],
      drug_interactions:    [{interacting_drug_id, interacting_drug_name, severity, description}],
    }
    """
    drug_id = (request_data.get("drugbank_id") or "").upper().strip()
    if not drug_id:
        raise HTTPException(status_code=422, detail="drugbank_id is required")
    if not re.match(r"^DB\d{5,}$", drug_id):
        raise HTTPException(status_code=422, detail="drugbank_id must match DB##### format")
    drug_name = (request_data.get("name") or "").strip()
    if not drug_name:
        raise HTTPException(status_code=422, detail="name is required")

    # Duplicate check
    existing = db.query(Drug).filter(Drug.drugbank_id == drug_id).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Drug {drug_id} already exists: {existing.name}")

    try:
        # ── 1. Core drug row ──────────────────────────────────────────────────
        drug = Drug(
            drugbank_id=drug_id,
            name=drug_name,
            drug_type=request_data.get("drug_type") or None,
            state=request_data.get("state") or None,
            average_mass=float(request_data["average_mass"]) if request_data.get("average_mass") not in (None, "") else None,
            mechanism_of_action=request_data.get("mechanism_of_action") or None,
            indication=request_data.get("indication") or None,
            toxicity=request_data.get("toxicity") or None,
            description=request_data.get("description") or None,
            pharmacodynamics=request_data.get("pharmacodynamics") or None,
        )
        db.add(drug)
        db.flush()  # get PK assigned before inserting children

        # ── 2. Synonyms ───────────────────────────────────────────────────────
        for s in (request_data.get("synonyms") or []):
            syn = (s.get("synonym") or "").strip()
            if syn:
                db.add(DrugSynonym(drug_id=drug_id, synonym=syn, language=s.get("language") or None))

        # ── 3. Drug products ──────────────────────────────────────────────────
        for p in (request_data.get("products") or []):
            pname = (p.get("name") or "").strip()
            if pname:
                db.add(DrugProduct(
                    drug_id=drug_id,
                    name=pname,
                    labeller=p.get("labeller") or None,
                    dosage_form=p.get("dosage_form") or None,
                    strength=p.get("strength") or None,
                    route=p.get("route") or None,
                    country=p.get("country") or None,
                ))

        # ── 4. External identifiers ───────────────────────────────────────────
        seen_resources: set[str] = set()
        for e in (request_data.get("ext_ids") or []):
            res = (e.get("resource") or "").strip()
            eid = (e.get("identifier") or "").strip()
            if res and eid and res not in seen_resources:
                db.add(DrugExternalIdentifier(drug_id=drug_id, resource=res, identifier=eid))
                seen_resources.add(res)

        # ── 5. Groups (N-N) ───────────────────────────────────────────────────
        for gid in (request_data.get("group_ids") or []):
            db.add(DrugGroupMap(drug_id=drug_id, group_id=int(gid)))

        # ── 6. Categories (N-N) ───────────────────────────────────────────────
        for cid in (request_data.get("category_ids") or []):
            db.add(DrugCategoryMap(drug_id=drug_id, category_id=int(cid)))

        # ── 7. Protein interactions ───────────────────────────────────────────
        for pi in (request_data.get("protein_interactions") or []):
            pid = pi.get("protein_id")
            if pid:
                db.add(DrugProteinInteraction(
                    drug_id=drug_id,
                    protein_id=int(pid),
                    interaction_type=pi.get("interaction_type") or "target",
                    known_action=pi.get("known_action") or "unknown",
                    actions=pi.get("actions") or [],
                ))

        # ── 8. Drug-Drug interactions (auto-normalize order A<B) ─────────────
        for di in (request_data.get("drug_interactions") or []):
            other_id = (di.get("interacting_drug_id") or "").upper().strip()
            if not other_id:
                continue
            # Normalize: smaller ID goes in drug_id
            a, b = sorted([drug_id, other_id])
            db.add(DrugInteraction(
                drug_id=a,
                drug_name=drug_name if a == drug_id else di.get("interacting_drug_name") or "",
                interacting_drug_id=b,
                interacting_drug_name=di.get("interacting_drug_name") or "" if b == other_id else drug_name,
                severity=di.get("severity") or "unknown",
                description=di.get("description") or None,
            ))

        db.commit()

        # Clear all relevant caches so the new drug appears immediately
        cache_delete_prefix("drugs:list:")
        cache_delete_prefix("drugs:detail:")
        cache_delete_prefix("drugs:cat:")
        cache_delete_prefix("drugs:network:")
        cache_delete("system:stats")

        return {"success": True, "drugbank_id": drug_id, "name": drug_name}

    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
