"""
FastAPI application entry point.

Run:
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi_cache import FastAPICache
from fastapi_cache.backends.inmemory import InMemoryBackend
from sqladmin import Admin

from app.admin import DrugAdmin
from app.config import get_settings
from app.database import Base, engine
from app.routers import drugs as drugs_router
from app.routers import api_drugs, api_substances, api_interactions, api_analysis, api_sessions, api_auth

settings = get_settings()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown events."""
    # Initialize in-memory cache
    FastAPICache.init(InMemoryBackend(), prefix="cdss-cache")
    yield


# ── Create tables at import time (before first request) ───────────────────────
# create_all is idempotent — safe to call on every startup.
try:
    Base.metadata.create_all(bind=engine)
except Exception as _db_exc:
    logger.warning("DB create_all skipped at startup: %s", _db_exc)


# ── App instance ──────────────────────────────────────────────────────────────

app = FastAPI(
    title=settings.app_title,
    version=settings.app_version,
    debug=settings.debug,
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    description="""
## Clinical Decision Support System (CDSS)

A drug intelligence platform combining DrugBank data with clinical decision engines.

### API Groups
| Group | Prefix | Description |
|-------|--------|-------------|
| **Drugs** | `/api/v1/drugs` | CRUD for drug monographs |
| **Substances** | `/api/v1/substances` | CRUD for proteins / active substances |
| **Interactions** | `/api/v1/interactions` | CRUD for drug-drug interactions |
| **Analysis** | `/api/v1/analysis` | Interaction Analysis, Risk Scoring, Recommendations |

### Clinical Engines
- **Interaction Analysis Engine** — detects all pairwise DDIs in a multi-drug prescription
- **Risk Scoring Engine** — 0–10 score based on severity + shared CYP/targets
- **Recommendation Engine** — ranked warnings with patient-context filters
    """,
)

# ── CORS ──────────────────────────────────────────────────────────────────────

# In debug mode allow all origins; in production allow all origins too
# (Railway + Vercel deployment — the real auth gate is the JWT token).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static files ──────────────────────────────────────────────────────────────

# Guard: StaticFiles raises RuntimeError if the directory is missing.
if settings.static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(settings.static_dir)), name="static")
else:
    logger.warning("Static directory not found, skipping mount: %s", settings.static_dir)

# ── Admin UI (sqladmin) ───────────────────────────────────────────────────────

# Guard: sqladmin >= 0.18 wraps the app lifespan; if DB inspect fails on
# startup it raises an unhandled exception inside asyncio_run.
try:
    admin = Admin(app, engine, title=f"{settings.app_title} — Admin")
    admin.add_view(DrugAdmin)
except Exception as _admin_exc:
    logger.warning("sqladmin Admin init skipped: %s", _admin_exc)

# ── Template-based HTML routers (existing) ────────────────────────────────────

app.include_router(drugs_router.router)

# ── REST API routers ──────────────────────────────────────────────────────────

app.include_router(api_drugs.router)
app.include_router(api_substances.router)
app.include_router(api_interactions.router)
app.include_router(api_analysis.router)
app.include_router(api_sessions.router)
app.include_router(api_auth.router)
