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
    # Railway MySQL plugin injects: MYSQLHOST, MYSQLPORT, MYSQLUSER,
    # MYSQLPASSWORD, MYSQLDATABASE  (set via Railway → Variables tab).
    # mysqlport is str (not int) so Pydantic never tries int-parsing on
    # Railway's raw value which may contain leading whitespace/tabs.
    mysqlhost: str = ""
    mysqlport: str = "3306"   # kept as str — converted manually in database_url
    mysqluser: str = ""
    mysqlpassword: str = ""
    mysqldatabase: str = ""
    db_charset: str = "utf8mb4"
    # Local dev fallbacks
    db_host: str = "127.0.0.1"
    db_port: int = 3306
    db_name: str = "cdss"
    db_user: str = "root"
    db_password: str = ""

    # Strip leading/trailing whitespace from ALL string env vars.
    # Railway occasionally injects values with tabs (e.g. MYSQLPORT="\t3306").
    @field_validator(
        "mysqlhost", "mysqlport", "mysqluser",
        "mysqlpassword", "mysqldatabase", "db_charset",
        "db_host", "db_name", "db_user", "db_password",
        mode="before",
    )
    @classmethod
    def strip_str(cls, v: Any) -> Any:
        if isinstance(v, str):
            return v.strip()
        return v

    @field_validator("db_port", mode="before")
    @classmethod
    def strip_db_port(cls, v: Any) -> Any:
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
        SQLAlchemy connection string for MySQL using PyMySQL driver.
        Priority:
          1. MYSQLHOST/… — Railway MySQL plugin vars (set in Variables tab)
          2. DB_HOST/…   — local development fallback
        Uses URL.create() to safely percent-encode passwords with special chars.
        """
        from sqlalchemy.engine import URL as _URL

        if self.mysqlhost and self.mysqluser:
            try:
                port = int(self.mysqlport)
            except (ValueError, TypeError):
                port = 3306
            url = _URL.create(
                drivername="mysql+pymysql",
                username=self.mysqluser,
                password=self.mysqlpassword,
                host=self.mysqlhost,
                port=port,
                database=self.mysqldatabase,
                query={"charset": self.db_charset},
            )
        else:
            url = _URL.create(
                drivername="mysql+pymysql",
                username=self.db_user,
                password=self.db_password,
                host=self.db_host,
                port=self.db_port,
                database=self.db_name,
                query={"charset": self.db_charset},
            )
        return url.render_as_string(hide_password=False)


@lru_cache
def get_settings() -> Settings:
    """Return cached Settings instance (created once at startup)."""
    return Settings()
