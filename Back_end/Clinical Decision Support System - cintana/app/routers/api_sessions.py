"""
Analysis Sessions API
======================
Persists drug interaction check sessions so users can review history.

  POST   /api/v1/sessions/           → Save a new session
  GET    /api/v1/sessions/           → List all sessions (paginated, searchable)
  GET    /api/v1/sessions/{id}       → Get one session with full detail
  PATCH  /api/v1/sessions/{id}       → Update title / tags / notes
  DELETE /api/v1/sessions/{id}       → Delete a session
  GET    /api/v1/sessions/stats      → Aggregate statistics for the Analysis dashboard
"""

from __future__ import annotations

from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, desc
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AnalysisSession

router = APIRouter(prefix="/api/v1/sessions", tags=["Analysis Sessions"])


# ═══════════════════════════════════════════════════════════════════════════════
# Pydantic Schemas (defined here to keep schemas.py clean)
# ═══════════════════════════════════════════════════════════════════════════════

class DrugSnapshot(BaseModel):
    id: str
    name: str


class InteractionRecord(BaseModel):
    drug_a_id: str
    drug_a_name: str
    drug_b_id: str
    drug_b_name: str
    severity: str
    description: str
    source: str = "DrugBank"


class SessionCreate(BaseModel):
    title: Optional[str] = Field(None, max_length=500)
    tags: Optional[str] = Field(None, max_length=500, description="Pipe-separated tags e.g. 'Cardiology|ICU'")
    drugs_snapshot: List[DrugSnapshot]
    interactions_found: List[InteractionRecord]
    total_drugs: int
    total_interactions: int
    major_count: int = 0
    moderate_count: int = 0
    minor_count: int = 0
    risk_score: Optional[float] = None
    risk_level: Optional[str] = None
    notes: Optional[str] = None


class SessionUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=500)
    tags: Optional[str] = Field(None, max_length=500)
    notes: Optional[str] = None


class SessionListItem(BaseModel):
    id: int
    title: str
    tags: Optional[str]
    total_drugs: int
    total_interactions: int
    major_count: int
    moderate_count: int
    minor_count: int
    risk_score: Optional[float]
    risk_level: Optional[str]
    drugs_snapshot: Optional[list]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class SessionDetail(SessionListItem):
    interactions_found: Optional[list]
    notes: Optional[str]

    class Config:
        from_attributes = True


class SessionStats(BaseModel):
    total_sessions: int
    total_interactions_checked: int
    total_major: int
    total_moderate: int
    total_minor: int
    most_checked_drugs: List[dict]
    sessions_by_month: List[dict]


# ═══════════════════════════════════════════════════════════════════════════════
# Routes
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/", response_model=SessionDetail, status_code=status.HTTP_201_CREATED,
             summary="Save a new interaction session")
def create_session(payload: SessionCreate, db: Session = Depends(get_db)):
    # Auto-generate title if not provided
    title = payload.title
    if not title:
        drug_names = ", ".join(d.name for d in payload.drugs_snapshot[:3])
        if len(payload.drugs_snapshot) > 3:
            drug_names += f" +{len(payload.drugs_snapshot) - 3}"
        title = f"Phác đồ: {drug_names}"

    session = AnalysisSession(
        title=title,
        tags=payload.tags,
        drugs_snapshot=[d.model_dump() for d in payload.drugs_snapshot],
        interactions_found=[i.model_dump() for i in payload.interactions_found],
        total_drugs=payload.total_drugs,
        total_interactions=payload.total_interactions,
        major_count=payload.major_count,
        moderate_count=payload.moderate_count,
        minor_count=payload.minor_count,
        risk_score=payload.risk_score,
        risk_level=payload.risk_level,
        notes=payload.notes,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.get("/stats", response_model=SessionStats, summary="Aggregated dashboard statistics")
def get_stats(db: Session = Depends(get_db)):
    total_sessions = db.query(func.count(AnalysisSession.id)).scalar() or 0
    total_interactions = db.query(func.sum(AnalysisSession.total_interactions)).scalar() or 0
    total_major = db.query(func.sum(AnalysisSession.major_count)).scalar() or 0
    total_moderate = db.query(func.sum(AnalysisSession.moderate_count)).scalar() or 0
    total_minor = db.query(func.sum(AnalysisSession.minor_count)).scalar() or 0

    # Top drugs: count frequency from all sessions' drugs_snapshot JSON
    # We do this in Python since JSON querying in MySQL varies
    all_sessions = db.query(AnalysisSession.drugs_snapshot).all()
    drug_freq: dict[str, int] = {}
    for (snapshot,) in all_sessions:
        if not snapshot:
            continue
        for drug in snapshot:
            key = drug.get("name", "Unknown")
            drug_freq[key] = drug_freq.get(key, 0) + 1
    most_checked = sorted(
        [{"name": k, "count": v} for k, v in drug_freq.items()],
        key=lambda x: x["count"], reverse=True
    )[:10]

    # Sessions by month (last 6 months)
    sessions_by_month_raw = (
        db.query(
            func.date_format(AnalysisSession.created_at, "%Y-%m").label("month"),
            func.count(AnalysisSession.id).label("count"),
        )
        .group_by("month")
        .order_by("month")
        .limit(12)
        .all()
    )
    sessions_by_month = [{"month": r.month, "count": r.count} for r in sessions_by_month_raw]

    return SessionStats(
        total_sessions=total_sessions,
        total_interactions_checked=int(total_interactions),
        total_major=int(total_major),
        total_moderate=int(total_moderate),
        total_minor=int(total_minor),
        most_checked_drugs=most_checked,
        sessions_by_month=sessions_by_month,
    )


@router.get("/", response_model=List[SessionListItem], summary="List all sessions")
def list_sessions(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None, description="Filter by title"),
    tag: Optional[str] = Query(None, description="Filter by tag"),
    db: Session = Depends(get_db),
):
    q = db.query(AnalysisSession)
    if search:
        q = q.filter(AnalysisSession.title.ilike(f"%{search}%"))
    if tag:
        q = q.filter(AnalysisSession.tags.ilike(f"%{tag}%"))
    total = q.count()
    sessions = q.order_by(desc(AnalysisSession.created_at)).offset(skip).limit(limit).all()
    return sessions


@router.get("/{session_id}", response_model=SessionDetail, summary="Get one session with full details")
def get_session(session_id: int, db: Session = Depends(get_db)):
    session = db.query(AnalysisSession).filter(AnalysisSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.patch("/{session_id}", response_model=SessionDetail, summary="Update title / tags / notes")
def update_session(session_id: int, payload: SessionUpdate, db: Session = Depends(get_db)):
    session = db.query(AnalysisSession).filter(AnalysisSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if payload.title is not None:
        session.title = payload.title
    if payload.tags is not None:
        session.tags = payload.tags
    if payload.notes is not None:
        session.notes = payload.notes
    db.commit()
    db.refresh(session)
    return session


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT,
                summary="Delete a session")
def delete_session(session_id: int, db: Session = Depends(get_db)):
    session = db.query(AnalysisSession).filter(AnalysisSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    db.delete(session)
    db.commit()
