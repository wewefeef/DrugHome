"""
Application configuration.
All settings are loaded from environment variables (via .env file).
"""

from pathlib import Path
from functools import lru_cache
from typing import Any

from pydantic import field_validator
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
        "mysql_url", "mysql_host", "mysql_user", "mysql_password", "mysql_database",
        "db_host", "db_name", "db_user", "db_password",
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
        Priority:
          1. MYSQL_URL  — full URL set manually in DrugHome → Variables
          2. MYSQL_HOST — individual vars auto-exported by Railway MySQL plugin
          3. DB_HOST/…  — local development fallback (default: 127.0.0.1)
        """
        import re
        from sqlalchemy.engine import URL as _URL

        def _fix_driver(url: str) -> str:
            url = re.sub(r"^mysql://", "mysql+pymysql://", url.strip())
            url = re.sub(r"^mysql\+mysqldb://", "mysql+pymysql://", url)
            if "charset=" not in url:
                sep = "&" if "?" in url else "?"
                url = f"{url}{sep}charset={self.db_charset}"
            return url

        # 1. Full URL env var
        if self.mysql_url:
            return _fix_driver(self.mysql_url)

        # 2. Individual Railway MySQL plugin vars (MYSQL_HOST etc.)
        if self.mysql_host:
            try:
                port = int(self.mysql_port) if self.mysql_port else 3306
            except ValueError:
                port = 3306
            return _URL.create(
                drivername="mysql+pymysql",
                username=self.mysql_user or "root",
                password=self.mysql_password or self.db_password,
                host=self.mysql_host,
                port=port,
                database=self.mysql_database or self.db_name,
                query={"charset": self.db_charset},
            ).render_as_string(hide_password=False)

        # 3. Local dev fallback
        return _URL.create(
            drivername="mysql+pymysql",
            username=self.db_user,
            password=self.db_password,
            host=self.db_host,
            port=self.db_port,
            database=self.db_name,
            query={"charset": self.db_charset},
        ).render_as_string(hide_password=False)


@lru_cache
def get_settings() -> Settings:
    """Return cached Settings instance (created once at startup)."""
    return Settings()
