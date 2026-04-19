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
    # Try DB create_all here too — idempotent, errors are non-fatal
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as _db_exc:
        logger.warning("DB create_all skipped in lifespan: %s", _db_exc)
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
    redirect_slashes=False,
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

# sqladmin >= 0.18 wraps the app lifespan and inspects the DB schema during
# ASGI startup. On Railway, MySQL may not be ready when the first instance
# starts → the lifespan raises an unhandled exception → "Application startup
# failed". Fix: re-wrap sqladmin's lifespan so DB failures are non-fatal.
try:
    admin = Admin(app, engine, title=f"{settings.app_title} — Admin")
    admin.add_view(DrugAdmin)

    # sqladmin has now replaced app.router.lifespan_context.
    # Wrap it to catch DB-connect errors so the app still starts.
    _admin_lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def _resilient_lifespan(a: FastAPI):
        try:
            async with _admin_lifespan(a):
                yield
        except Exception as _sq_exc:
            logger.warning(
                "sqladmin lifespan failed (DB not ready?), running without admin UI: %s",
                _sq_exc,
            )
            # Re-run our own base lifespan so cache + create_all still happen
            FastAPICache.init(InMemoryBackend(), prefix="cdss-cache")
            try:
                Base.metadata.create_all(bind=engine)
            except Exception:
                pass
            yield

    app.router.lifespan_context = _resilient_lifespan

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
