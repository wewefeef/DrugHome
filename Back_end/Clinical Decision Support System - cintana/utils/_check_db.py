"""DB diagnostics — run from project root or utils/."""
import logging, sys
from pathlib import Path
logging.disable(logging.CRITICAL)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import engine
from sqlalchemy import text

with engine.connect() as conn:
    v = conn.execute(text("SELECT version_num FROM alembic_version")).fetchall()
    print("version:", v)
    cnt = conn.execute(text("SELECT COUNT(*) FROM drug_interactions WHERE drug_code = '' OR drug_code IS NULL")).scalar()
    print("empty_drug_code:", cnt)
    cnt2 = conn.execute(text("SELECT COUNT(*) FROM drug_interactions")).scalar()
    print("total_interactions:", cnt2)
    sample = conn.execute(text("SELECT drug_code, interacting_drug_id, severity FROM drug_interactions LIMIT 3")).fetchall()
    print("sample:", sample)
