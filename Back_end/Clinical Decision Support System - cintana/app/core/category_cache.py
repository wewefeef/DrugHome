"""
Category cache — pre-resolves CATEGORY_KEY → [category_id, ...] at startup.

Why this matters
----------------
The category drug query used to do:
    JOIN categories c ON dcm.category_id = c.id
    WHERE c.category LIKE '%Analgesic%' OR c.category LIKE '%Antipyretic%' ...

A leading-wildcard LIKE ('%keyword%') cannot use B-tree indexes → full table
scan on every request.

After warm(), we replace that entire join with:
    WHERE dcm.category_id IN (1, 5, 22, 47, ...)

This hits the new ix_dcm_cat_drug(category_id, drug_id) index directly.
First request is slightly slower (loads from DB), every subsequent call is O(1).
"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Populated once at startup
_cat_ids: Dict[str, List[int]] = {}
_warmed = False


def warm(db: Session) -> None:
    """
    Load ALL rows from the `categories` table once, then resolve
    CATEGORY_KEYWORDS → matching category IDs.

    Call this in the FastAPI lifespan after DB is ready.
    """
    global _cat_ids, _warmed
    if _warmed:
        return

    from app.models import DrugCategory
    from app.core.category_keywords import CATEGORY_KEYWORDS

    # Single query — load all (id, category_name) pairs
    all_cats: list[tuple[int, str]] = db.query(
        DrugCategory.id, DrugCategory.category
    ).all()

    if not all_cats:
        logger.warning("Category cache: categories table is empty, skipping warm.")
        return

    for key, keywords in CATEGORY_KEYWORDS.items():
        kw_lower = [k.lower() for k in keywords]
        ids = [
            cat_id
            for cat_id, cat_name in all_cats
            if any(kw in cat_name.lower() for kw in kw_lower)
        ]
        _cat_ids[key] = ids
        logger.debug("Category cache: %s → %d IDs", key, len(ids))

    _warmed = True
    logger.info(
        "Category cache warmed: %d keys, %d total category rows",
        len(_cat_ids),
        len(all_cats),
    )


def get_ids(key: str) -> Optional[List[int]]:
    """Return pre-loaded category IDs, or None if cache not warmed yet."""
    return _cat_ids.get(key)


def is_warmed() -> bool:
    return _warmed
