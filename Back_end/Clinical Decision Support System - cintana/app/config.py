"""
Application configuration.
All settings are loaded from environment variables (via .env file).
"""

import os
import re
from pathlib import Path
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parent.parent


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

    # ── Database (MySQL) ──────────────────────────────────────────────────────
    db_host: str = "127.0.0.1"
    db_port: int = 3306
    db_name: str = "cdss"
    db_user: str = "root"
    db_password: str = ""
    db_charset: str = "utf8mb4"

    # Railway MySQL plugin injects DATABASE_URL automatically.
    # pydantic-settings with case_sensitive=False reads it case-insensitively.
    database_url_env: str = Field(default="", validation_alias="DATABASE_URL")

    # ── Paths ─────────────────────────────────────────────────────────────────
    templates_dir: Path = BASE_DIR / "drugs" / "templates"
    static_dir: Path = BASE_DIR / "static"

    # ── Cache ─────────────────────────────────────────────────────────────────
    cache_ttl: int = 300  # seconds

    # ── Security ──────────────────────────────────────────────────────────────
    secret_key: str = "change-me-in-production-use-a-long-random-string"

    # ── CORS ──────────────────────────────────────────────────────────────────
    allowed_origins: str = "*"

    @property
    def database_url(self) -> str:
        """
        SQLAlchemy connection string for MySQL using PyMySQL driver.

        Priority (highest → lowest):
          1. DATABASE_URL  — pydantic validation_alias (case-insensitive env lookup)
                             Railway sets this when MySQL plugin is linked.
          2. MYSQL_URL     — Railway reference variable (set manually in Variables tab)
          3. MYSQL_HOST    — Railway MySQL plugin individual vars (with underscore)
          4. MYSQLHOST     — Railway MySQL plugin individual vars (no underscore)
          5. db_host       — local development fallback (127.0.0.1)
        """
        def _fix(url: str) -> str:
            """Normalize any mysql:// URL to mysql+pymysql:// with charset."""
            url = url.strip()
            url = re.sub(r"^mysql://", "mysql+pymysql://", url)
            url = re.sub(r"^mysql\+mysqldb://", "mysql+pymysql://", url)
            if "charset=" not in url:
                sep = "&" if "?" in url else "?"
                url = f"{url}{sep}charset={self.db_charset}"
            return url

        # 1. DATABASE_URL via pydantic validation_alias (case-insensitive lookup)
        if self.database_url_env:
            return _fix(self.database_url_env)

        # 2. MYSQL_URL — Railway manually-set reference variable
        raw = os.environ.get("MYSQL_URL", "").strip()
        if raw:
            return _fix(raw)

        # 3. MYSQL_HOST individual vars (with underscore — Railway MySQL plugin)
        host = os.environ.get("MYSQL_HOST", "").strip()
        if host:
            try:
                port = int(os.environ.get("MYSQL_PORT", "3306").strip() or "3306")
            except ValueError:
                port = 3306
            user = (os.environ.get("MYSQL_USER") or self.db_user).strip()
            password = (os.environ.get("MYSQL_PASSWORD") or self.db_password).strip()
            database = (os.environ.get("MYSQL_DATABASE") or self.db_name).strip()
            return (
                f"mysql+pymysql://{user}:{password}"
                f"@{host}:{port}/{database}?charset={self.db_charset}"
            )

        # 4. MYSQLHOST individual vars (no underscore — older Railway format)
        host = os.environ.get("MYSQLHOST", "").strip()
        if host:
            try:
                port = int(os.environ.get("MYSQLPORT", "3306").strip() or "3306")
            except ValueError:
                port = 3306
            user = (os.environ.get("MYSQLUSER") or self.db_user).strip()
            password = (os.environ.get("MYSQLPASSWORD") or self.db_password).strip()
            database = (os.environ.get("MYSQLDATABASE") or self.db_name).strip()
            return (
                f"mysql+pymysql://{user}:{password}"
                f"@{host}:{port}/{database}?charset={self.db_charset}"
            )

        # 5. Local dev fallback
        return (
            f"mysql+pymysql://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
            f"?charset={self.db_charset}"
        )


@lru_cache
def get_settings() -> Settings:
    """Return cached Settings instance (created once at startup)."""
    return Settings()
