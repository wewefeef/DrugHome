"""
Application configuration.
All settings are loaded from environment variables (via .env file).
"""

import os
import re
from pathlib import Path
from functools import lru_cache
from urllib.parse import quote_plus

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parent.parent


def _to_pymysql(url: str) -> str:
    """Ensure URL uses mysql+pymysql:// driver prefix."""
    if not url:
        return url
    # Replace bare mysql:// or mysql+mysqlconnector:// → mysql+pymysql://
    return re.sub(r"^mysql(\+\w+)?://", "mysql+pymysql://", url)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ───────────────────────────────────────────────────────────────────
    debug: bool = True
    app_title: str = "Clinical Decision Support System"
    app_version: str = "1.0.0"

    # ── Database (MySQL) — local / fallback ───────────────────────────────────
    db_host: str = "127.0.0.1"
    db_port: int = 3306
    db_name: str = "cdss"
    db_user: str = "root"
    db_password: str = ""
    db_charset: str = "utf8mb4"

    # Generic DATABASE_URL — set this in .env on any server/VPS
    database_url_env: str = Field(default="", validation_alias="DATABASE_URL")

    # ── Paths ─────────────────────────────────────────────────────────────────
    templates_dir: Path = BASE_DIR / "drugs" / "templates"
    static_dir: Path = BASE_DIR / "static"

    # ── Cache ─────────────────────────────────────────────────────────────────
    cache_ttl: int = 300  # seconds

    # ── Security ──────────────────────────────────────────────────────────────
    secret_key: str = "change-me-in-production-use-a-long-random-string"

    # ── Admin Panel ───────────────────────────────────────────────────────────
    admin_username: str = "admin"
    admin_password: str = "change-me-admin-password"

    # ── CORS ──────────────────────────────────────────────────────────────────
    allowed_origins: str = "*"

    @property
    def database_url(self) -> str:
        """
        SQLAlchemy connection string for MySQL using PyMySQL driver.
        Priority (highest → lowest):
          1. DATABASE_URL env var  (set in .env or server environment)
          2. Individual DB_* fields from .env (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD)
        """
        # 1. DATABASE_URL full connection string
        if self.database_url_env:
            return _to_pymysql(self.database_url_env)

        # 2. Direct os.environ fallback (bypasses pydantic lru_cache issues)
        val = os.environ.get("DATABASE_URL", "")
        if val:
            return _to_pymysql(val)

        # 3. Local / VPS individual vars — URL-encode password to handle special chars (@, !, etc.)
        encoded_password = quote_plus(self.db_password)
        return (
            f"mysql+pymysql://{self.db_user}:{encoded_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
            f"?charset={self.db_charset}"
        )


@lru_cache
def get_settings() -> Settings:
    """Return cached Settings instance (created once at startup)."""
    return Settings()
