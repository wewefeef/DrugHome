"""
Database engine and session factory.
Uses SQLAlchemy 2.0 synchronous engine with PyMySQL driver for MySQL.
"""

from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


# ── Engine ────────────────────────────────────────────────────────────────────

def _make_engine():
    settings = get_settings()
    return create_engine(
        settings.database_url,
        pool_pre_ping=True,         # verify connection health before use
        pool_recycle=3600,          # recycle connections after 1 hour
        pool_size=10,
        max_overflow=20,
        echo=settings.debug,        # log SQL when DEBUG=True
    )


engine = _make_engine()

SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
)


# ── Declarative Base ──────────────────────────────────────────────────────────

class Base(DeclarativeBase):
    """Base class for all SQLAlchemy ORM models."""
    pass


# ── Dependency ────────────────────────────────────────────────────────────────

def get_db() -> Generator[Session, None, None]:
    """
    FastAPI dependency that yields a database session per request.
    Usage:
        @router.get("/")
        def my_route(db: Session = Depends(get_db)):
            ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
