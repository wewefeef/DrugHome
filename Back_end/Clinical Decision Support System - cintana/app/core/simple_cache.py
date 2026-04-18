"""
Simple in-process TTL cache
============================
Lightweight alternative to Redis for development / single-server deployments.
Thread-safe for read/write thanks to Python's GIL protecting dict operations.

Usage::

    from app.core.simple_cache import cache_get, cache_set, cache_delete_prefix

    # In a GET handler:
    key = f"drugs:list:{q}:{page}:{per_page}"
    cached = cache_get(key)
    if cached is not None:
        return cached
    result = ... # expensive DB query
    cache_set(key, result, ttl=300)
    return result

    # In a POST/PATCH/DELETE handler:
    cache_delete_prefix("drugs:list:")
    cache_delete(f"drugs:detail:{drugbank_id}")
"""
from __future__ import annotations

import time
from typing import Any, Optional

# Storage: key → (value, expiry_monotonic)
_STORE: dict[str, tuple[Any, float]] = {}


def cache_get(key: str) -> Optional[Any]:
    """Return the cached value for *key*, or ``None`` if missing/expired."""
    entry = _STORE.get(key)
    if entry is None:
        return None
    val, exp = entry
    if time.monotonic() < exp:
        return val
    # Expired — evict lazily
    _STORE.pop(key, None)
    return None


def cache_set(key: str, val: Any, ttl: int = 300) -> None:
    """Store *val* under *key* with a TTL in seconds."""
    _STORE[key] = (val, time.monotonic() + ttl)


def cache_delete(key: str) -> None:
    """Remove a single cache entry."""
    _STORE.pop(key, None)


def cache_delete_prefix(prefix: str) -> None:
    """Remove all entries whose key starts with *prefix*."""
    for k in list(_STORE):
        if k.startswith(prefix):
            del _STORE[k]
