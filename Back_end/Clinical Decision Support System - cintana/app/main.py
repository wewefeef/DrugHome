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
    """Idempotent startup migration for Railway MySQL.

    SQLAlchemy create_all() never ALTERs existing tables. Railway was first
    deployed with an older schema (drug_code PKs, no smiles, etc.). This
    function detects and repairs every known structural difference so the
    app works regardless of which deployment created the live tables.

    Safe to call on every startup — all changes are gated by existence checks.
    """
    from sqlalchemy import text as _text

    def _col_exists(conn, table: str, col: str) -> bool:
        return bool(conn.execute(_text(
            "SELECT COUNT(*) FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:t AND COLUMN_NAME=:c"
        ), {"t": table, "c": col}).scalar())

    def _fk_exists(conn, table: str, fk: str) -> bool:
        return bool(conn.execute(_text(
            "SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS "
            "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:t "
            "AND CONSTRAINT_NAME=:n AND CONSTRAINT_TYPE='FOREIGN KEY'"
        ), {"t": table, "n": fk}).scalar())

    def _idx_exists(conn, table: str, idx: str) -> bool:
        return bool(conn.execute(_text(
            "SELECT COUNT(*) FROM information_schema.STATISTICS "
            "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:t AND INDEX_NAME=:i"
        ), {"t": table, "i": idx}).scalar())

    def _drop_fk_if_exists(conn, table: str, fk: str):
        if _fk_exists(conn, table, fk):
            conn.execute(_text(f"ALTER TABLE `{table}` DROP FOREIGN KEY `{fk}`"))
            logger.info("Schema repair: dropped FK %s on %s", fk, table)

    def _drop_col_if_exists(conn, table: str, col: str):
        if _col_exists(conn, table, col):
            conn.execute(_text(f"ALTER TABLE `{table}` DROP COLUMN `{col}`"))
            logger.info("Schema repair: dropped column %s.%s", table, col)

    try:
        with engine.begin() as conn:

            # ── 1. drugs: add columns missing from old schema ─────────────────
            for col, defn in [
                ("smiles",              "TEXT NULL"),
                ("molecular_formula",   "VARCHAR(200) NULL"),
                ("average_mass",        "DECIMAL(14,6) NULL"),
                ("monoisotopic_mass",   "DECIMAL(14,6) NULL"),
                ("created_at",
                 "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"),
                ("updated_at",
                 "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP "
                 "ON UPDATE CURRENT_TIMESTAMP"),
            ]:
                if not _col_exists(conn, "drugs", col):
                    conn.execute(_text(
                        f"ALTER TABLE `drugs` ADD COLUMN `{col}` {defn}"
                    ))
                    logger.info("Schema repair: added drugs.%s", col)

            # ── 2. drug_protein_interactions: migrate drug_code → drug_id ─────
            if not _col_exists(conn, "drug_protein_interactions", "drug_id"):
                logger.info("Schema repair: migrating drug_protein_interactions "
                            "drug_code → drug_id …")
                # Drop known FK constraints first
                for fk in ("fk_dpi_drug_code", "fk_dpi_drug",
                           "drug_protein_interactions_ibfk_1"):
                    _drop_fk_if_exists(conn, "drug_protein_interactions", fk)

                # Add the new column
                conn.execute(_text(
                    "ALTER TABLE drug_protein_interactions "
                    "ADD COLUMN drug_id VARCHAR(20) NULL"
                ))

                # Populate: prefer drug_drugbank_id (already normalised ID),
                # fall back to drug_code (old PK col = drugbank_id on old schema)
                if _col_exists(conn, "drug_protein_interactions", "drug_drugbank_id"):
                    conn.execute(_text(
                        "UPDATE drug_protein_interactions "
                        "SET drug_id = drug_drugbank_id "
                        "WHERE drug_drugbank_id IS NOT NULL "
                        "  AND drug_drugbank_id != ''"
                    ))
                if _col_exists(conn, "drug_protein_interactions", "drug_code"):
                    conn.execute(_text(
                        "UPDATE drug_protein_interactions "
                        "SET drug_id = drug_code "
                        "WHERE (drug_id IS NULL OR drug_id = '') "
                        "  AND drug_code IS NOT NULL AND drug_code != ''"
                    ))

                # Remove rows we cannot map (safety)
                conn.execute(_text(
                    "DELETE FROM drug_protein_interactions "
                    "WHERE drug_id IS NULL OR drug_id = ''"
                ))

                # Make NOT NULL
                conn.execute(_text(
                    "ALTER TABLE drug_protein_interactions "
                    "MODIFY COLUMN drug_id VARCHAR(20) NOT NULL"
                ))

                # Drop obsolete columns
                _drop_col_if_exists(conn, "drug_protein_interactions", "drug_code")
                _drop_col_if_exists(conn, "drug_protein_interactions", "drug_drugbank_id")

                # Add index used by list_drugs batch-count query
                if not _idx_exists(conn, "drug_protein_interactions", "ix_dpi_drug_type"):
                    conn.execute(_text(
                        "ALTER TABLE drug_protein_interactions "
                        "ADD INDEX ix_dpi_drug_type (drug_id, interaction_type)"
                    ))
                logger.info("Schema repair: drug_protein_interactions ✓")

            # ── 3. drug_interactions: migrate drug_code / drug_drugbank_id → drug_id
            if not _col_exists(conn, "drug_interactions", "drug_id"):
                logger.info("Schema repair: migrating drug_interactions "
                            "drug_code → drug_id …")
                for fk in ("fk_di_drug_code", "fk_di_drug",
                           "drug_interactions_ibfk_1"):
                    _drop_fk_if_exists(conn, "drug_interactions", fk)

                conn.execute(_text(
                    "ALTER TABLE drug_interactions "
                    "ADD COLUMN drug_id VARCHAR(20) NULL"
                ))

                if _col_exists(conn, "drug_interactions", "drug_drugbank_id"):
                    conn.execute(_text(
                        "UPDATE drug_interactions "
                        "SET drug_id = drug_drugbank_id "
                        "WHERE drug_drugbank_id IS NOT NULL "
                        "  AND drug_drugbank_id != ''"
                    ))
                if _col_exists(conn, "drug_interactions", "drug_code"):
                    conn.execute(_text(
                        "UPDATE drug_interactions "
                        "SET drug_id = drug_code "
                        "WHERE (drug_id IS NULL OR drug_id = '') "
                        "  AND drug_code IS NOT NULL AND drug_code != ''"
                    ))

                conn.execute(_text(
                    "DELETE FROM drug_interactions "
                    "WHERE drug_id IS NULL OR drug_id = ''"
                ))
                conn.execute(_text(
                    "ALTER TABLE drug_interactions "
                    "MODIFY COLUMN drug_id VARCHAR(20) NOT NULL"
                ))

                _drop_col_if_exists(conn, "drug_interactions", "drug_code")
                _drop_col_if_exists(conn, "drug_interactions", "drug_drugbank_id")

                if not _idx_exists(conn, "drug_interactions", "ix_di_drug_severity"):
                    conn.execute(_text(
                        "ALTER TABLE drug_interactions "
                        "ADD INDEX ix_di_drug_severity (drug_id, severity)"
                    ))
                logger.info("Schema repair: drug_interactions ✓")

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
