"""
FastAPI application entry point.

Run:
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
"""

import logging
import traceback
import json
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
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

# ── Auto-seeder for proteins + drug_protein_interactions ──────────────────────

SEED_DIR = Path(__file__).resolve().parent.parent / "seed_data"


def _repair_schema_if_needed():
    """Add any columns that are missing from existing Railway MySQL tables.

    SQLAlchemy's create_all() only creates NEW tables; it never ALTERs existing
    ones. When Railway re-deploys with a model change the live tables stay stale.
    This function checks each column via information_schema and adds it if absent.
    """
    from sqlalchemy import text as _text

    def _col_exists(conn, table: str, col: str) -> bool:
        return bool(conn.execute(_text(
            "SELECT COUNT(*) FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:t AND COLUMN_NAME=:c"
        ), {"t": table, "c": col}).scalar())

    repairs = [
        # columns added to `drugs` by migration 0004 / recent model changes
        ("drugs", "smiles",             "TEXT NULL"),
        ("drugs", "molecular_formula",  "VARCHAR(200) NULL"),
        ("drugs", "average_mass",       "DECIMAL(14,6) NULL"),
        ("drugs", "monoisotopic_mass",  "DECIMAL(14,6) NULL"),
        ("drugs", "created_at",
         "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"),
        ("drugs", "updated_at",
         "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
    ]

    try:
        with engine.begin() as conn:
            for table, col, defn in repairs:
                if not _col_exists(conn, table, col):
                    conn.execute(_text(
                        f"ALTER TABLE `{table}` ADD COLUMN `{col}` {defn}"
                    ))
                    logger.info("Schema repair: added %s.%s", table, col)
    except Exception as exc:
        logger.error("Schema repair failed: %s", exc, exc_info=True)


def _run_seed_if_empty():
    """Seed proteins and DPI tables from bundled NDJSON if they are empty.
    Uses the existing SQLAlchemy engine so Railway DB credentials are respected."""
    from sqlalchemy import text as _text
    from app.database import engine

    proteins_file = SEED_DIR / "proteins.ndjson"
    dpi_file = SEED_DIR / "drug_protein_interactions.ndjson"
    if not proteins_file.exists() or not dpi_file.exists():
        logger.warning("Seed data files not found in %s — skipping auto-seed", SEED_DIR)
        return

    try:
        with engine.connect() as conn:
            protein_count = conn.execute(_text("SELECT COUNT(*) FROM proteins")).scalar() or 0
            dpi_count = conn.execute(_text("SELECT COUNT(*) FROM drug_protein_interactions")).scalar() or 0
    except Exception as exc:
        logger.warning("Auto-seed: could not query counts (%s) — skipping", exc)
        return

    # ── Seed proteins ──
    if protein_count == 0:
        logger.info("Auto-seeding proteins from %s…", proteins_file)
        rows = []
        with open(proteins_file, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                d = json.loads(line)
                rows.append({
                    "id": d.get("id"),
                    "uniprot_id": (d.get("uniprot_id") or "")[:50],
                    "entrez_gene_id": d.get("entrez_gene_id") or None,
                    "organism": (d.get("organism") or "")[:200],
                    "name": (d.get("name") or "")[:500],
                    "gene_name": d.get("gene_name") or None,
                })
        try:
            with engine.begin() as conn:
                conn.execute(_text(
                    "INSERT INTO proteins (id, uniprot_id, entrez_gene_id, organism, name, gene_name)"
                    " VALUES (:id,:uniprot_id,:entrez_gene_id,:organism,:name,:gene_name)"
                    " ON DUPLICATE KEY UPDATE name=VALUES(name)"
                ), rows)
            logger.info("Auto-seed proteins: %d rows inserted", len(rows))
        except Exception as exc:
            logger.error("Auto-seed proteins failed: %s", exc, exc_info=True)
    else:
        logger.info("proteins table has %d rows — skipping seed", protein_count)

    # ── Seed drug_protein_interactions ──
    if dpi_count == 0:
        logger.info("Auto-seeding drug_protein_interactions from %s…", dpi_file)
        rows = []
        with open(dpi_file, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                d = json.loads(line)
                rows.append({
                    "drug_id": d.get("drug_id", ""),
                    "protein_id": d.get("protein_id"),
                    "uniprot_id": (d.get("uniprot_id") or "")[:50],
                    "interaction_type": (d.get("interaction_type") or "")[:20],
                    "known_action": (d.get("known_action") or "unknown")[:20],
                    "actions": json.dumps(d.get("actions") or []),
                    "pubmed_ids": json.dumps(d.get("pubmed_ids") or []),
                })
        try:
            with engine.begin() as conn:
                conn.execute(_text(
                    "INSERT INTO drug_protein_interactions"
                    " (drug_id, protein_id, uniprot_id, interaction_type, known_action, actions, pubmed_ids)"
                    " VALUES (:drug_id,:protein_id,:uniprot_id,:interaction_type,"
                    ":known_action,:actions,:pubmed_ids)"
                    " ON DUPLICATE KEY UPDATE interaction_type=VALUES(interaction_type)"
                ), rows)
            logger.info("Auto-seed DPI: %d rows inserted", len(rows))
        except Exception as exc:
            logger.error("Auto-seed DPI failed: %s", exc, exc_info=True)
    else:
        logger.info("drug_protein_interactions has %d rows — skipping seed", dpi_count)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown events."""
    FastAPICache.init(InMemoryBackend(), prefix="cdss-cache")
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("DB tables verified OK")
    except Exception as exc:
        logger.warning("DB table check failed (non-fatal): %s", exc)
    # Repair any columns missing from pre-existing Railway MySQL tables
    _repair_schema_if_needed()
    # Auto-seed protein data in background so startup isn't blocked
    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _run_seed_if_empty)
    except Exception as exc:
        logger.warning("Auto-seed executor failed (non-fatal): %s", exc)
    yield


# ── App instance ──────────────────────────────────────────────────────────────

app = FastAPI(
    title=settings.app_title,
    version=settings.app_version,
    debug=True,
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

# ── Global exception handler — always return JSON ────────────────────────────

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    tb = traceback.format_exc()
    logger.error("Unhandled exception on %s %s:\n%s", request.method, request.url, tb)
    return JSONResponse(
        status_code=500,
        content={"detail": f"{type(exc).__name__}: {exc}"},
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

if settings.static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(settings.static_dir)), name="static")
else:
    logger.warning("Static dir not found, skipping mount: %s", settings.static_dir)

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
