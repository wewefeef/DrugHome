"""
Application configuration.
All settings are loaded from environment variables (via .env file).
"""

from pathlib import Path
from functools import lru_cache
from typing import Any

from pydantic import Field, field_validator
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
    # Priority for database_url property (highest to lowest):
    #   1. MYSQL_URL      — full URL set manually in DrugHome Variables:
    #                        MYSQL_URL = ${{MySQL.MYSQL_URL}}
    #   2. MYSQL_HOST     — individual vars auto-exported by Railway MySQL plugin
    #   3. DB_HOST / ...  — local development fallback (defaults to 127.0.0.1)
    database_url_env: str = Field(default="", validation_alias="DATABASE_URL")  # Railway auto-injects DATABASE_URL
    mysql_url: str = ""         # MYSQL_URL (full connection string)
    mysql_host: str = ""        # MYSQL_HOST  ← Railway MySQL plugin
    mysql_port: str = ""        # MYSQL_PORT  ← Railway MySQL plugin (string to handle whitespace)
    mysql_user: str = ""        # MYSQL_USER  ← Railway MySQL plugin
    mysql_password: str = ""    # MYSQL_PASSWORD ← Railway MySQL plugin
    mysql_database: str = ""    # MYSQL_DATABASE ← Railway MySQL plugin
    db_host: str = "127.0.0.1"
    db_port: int = 3306
    db_name: str = "cdss"
    db_user: str = "root"
    db_password: str = ""
    db_charset: str = "utf8mb4"

    # Strip whitespace Railway may inject into env var values
    @field_validator(
        "database_url_env", "mysql_url", "mysql_host", "mysql_user", "mysql_password",
        "mysql_database", "db_host", "db_name", "db_user", "db_password",
        mode="before",
    )
    @classmethod
    def strip_str(cls, v: Any) -> Any:
        if isinstance(v, str):
            return v.strip()
        return v

    @field_validator("mysql_port", "db_port", mode="before")
    @classmethod
    def strip_port(cls, v: Any) -> Any:
        if isinstance(v, str):
            return v.strip()
        return v

    # ── Paths ─────────────────────────────────────────────────────────────────
    templates_dir: Path = BASE_DIR / "drugs" / "templates"
    static_dir: Path = BASE_DIR / "static"

    # ── Cache ─────────────────────────────────────────────────────────────────
    cache_ttl: int = 300  # seconds

    # ── Security ──────────────────────────────────────────────────────────────
    secret_key: str = "change-me-in-production-use-a-long-random-string"

    @property
    def database_url(self) -> str:
        """
        Build the SQLAlchemy connection URL.

        Env var priority (highest → lowest):
          1. MYSQL_URL        — full URL, set manually in Railway DrugHome Variables:
                                  MYSQL_URL = ${{MySQL.MYSQL_URL}}
          2. DATABASE_URL     — common Heroku/Railway convention (full URL)
          3. MYSQL_HOST       — individual vars, Railway MySQL plugin (with underscore)
          4. MYSQLHOST        — individual vars, some Railway templates (no underscore)
          5. DB_HOST / ...    — local development fallback (default: 127.0.0.1)
        """
        import os
        import re
        from sqlalchemy.engine import URL as _URL

        def _fix_driver(url: str) -> str:
            """Normalize any mysql:// URL to mysql+pymysql:// with charset."""
            url = url.strip()
            url = re.sub(r"^mysql://", "mysql+pymysql://", url)
            url = re.sub(r"^mysql\+mysqldb://", "mysql+pymysql://", url)
            if "charset=" not in url:
                sep = "&" if "?" in url else "?"
                url = f"{url}{sep}charset={self.db_charset}"
            return url

        def _build_url(host: str, port: int, user: str, password: str, db: str) -> str:
            return _URL.create(
                drivername="mysql+pymysql",
                username=user,
                password=password,
                host=host,
                port=port,
                database=db,
                query={"charset": self.db_charset},
            ).render_as_string(hide_password=False)

        # 1. DATABASE_URL (pydantic validation_alias — Railway auto-injects this)
        if self.database_url_env:
            return _fix_driver(self.database_url_env)

        # 2. MYSQL_URL (pydantic-settings field — set manually in Railway Variables)
        if self.mysql_url:
            return _fix_driver(self.mysql_url)

        # 3. DATABASE_URL direct env read (edge case: not picked up by pydantic)
        database_url_raw = os.environ.get("DATABASE_URL", "").strip()
        if database_url_raw:
            return _fix_driver(database_url_raw)

        # 4. MYSQL_HOST (with underscore — Railway MySQL plugin standard)
        if self.mysql_host:
            try:
                port = int(self.mysql_port) if self.mysql_port else 3306
            except ValueError:
                port = 3306
            return _build_url(
                host=self.mysql_host,
                port=port,
                user=self.mysql_user or self.db_user,
                password=self.mysql_password or self.db_password,
                db=self.mysql_database or self.db_name,
            )

        # 4. MYSQLHOST (no underscore — some Railway templates)
        mysqlhost = os.environ.get("MYSQLHOST", "").strip()
        if mysqlhost:
            try:
                mysqlport = int(os.environ.get("MYSQLPORT", "3306").strip() or "3306")
            except ValueError:
                mysqlport = 3306
            return _build_url(
                host=mysqlhost,
                port=mysqlport,
                user=os.environ.get("MYSQLUSER", self.db_user).strip(),
                password=os.environ.get("MYSQLPASSWORD", self.db_password).strip(),
                db=os.environ.get("MYSQLDATABASE", self.db_name).strip(),
            )

        # 5. Local dev fallback
        return _build_url(
            host=self.db_host,
            port=self.db_port,
            user=self.db_user,
            password=self.db_password,
            db=self.db_name,
        )


@lru_cache
def get_settings() -> Settings:
    """Return cached Settings instance (created once at startup)."""
    return Settings()
