"""
FastAPI application entry point.

Run:
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
"""

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown events."""
    # Create any missing tables (new models: proteins, drug_interactions, etc.)
    Base.metadata.create_all(bind=engine)
    # Initialize in-memory cache (swap for RedisBackend in production)
    FastAPICache.init(InMemoryBackend(), prefix="cdss-cache")
    yield


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

app.add_middleware(
    CORSMiddleware,
    allow_origins=(
        ["*"] if settings.allowed_origins == "*"
        else [o.strip() for o in settings.allowed_origins.split(",")]
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static files ──────────────────────────────────────────────────────────────

app.mount("/static", StaticFiles(directory=str(settings.static_dir)), name="static")

# ── Admin UI (sqladmin) ───────────────────────────────────────────────────────

admin = Admin(app, engine, title=f"{settings.app_title} — Admin")
admin.add_view(DrugAdmin)

# ── Template-based HTML routers (existing) ────────────────────────────────────

app.include_router(drugs_router.router)

# ── REST API routers ──────────────────────────────────────────────────────────

app.include_router(api_drugs.router)
app.include_router(api_substances.router)
app.include_router(api_interactions.router)
app.include_router(api_analysis.router)
app.include_router(api_sessions.router)
app.include_router(api_auth.router)
