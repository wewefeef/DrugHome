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
    # Railway MySQL plugin automatically exports MYSQL_URL (full connection
    # string). Add ONE variable in DrugHome → Variables:
    #   MYSQL_URL = ${{MySQL.MYSQL_URL}}
    # Railway resolves the reference to the actual URL at deploy time.
    # Fallback to individual DB_* vars for local development.
    mysql_url: str = ""        # MYSQL_URL from Railway MySQL plugin
    db_host: str = "127.0.0.1"
    db_port: int = 3306
    db_name: str = "cdss"
    db_user: str = "root"
    db_password: str = ""
    db_charset: str = "utf8mb4"

    # Strip whitespace Railway may inject into env var values
    @field_validator("mysql_url", "db_host", "db_name", "db_user", "db_password", mode="before")
    @classmethod
    def strip_str(cls, v: Any) -> Any:
        if isinstance(v, str):
            return v.strip()
        return v

    @field_validator("db_port", mode="before")
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
          1. MYSQL_URL  — full URL exported by Railway MySQL plugin
                          (set MYSQL_URL = ${{MySQL.MYSQL_URL}} in DrugHome Variables)
          2. DB_HOST/…  — local development fallback
        """
        import re
        from sqlalchemy.engine import URL as _URL

        if self.mysql_url:
            # Railway exports mysql:// — convert driver to mysql+pymysql
            url = re.sub(r"^mysql://", "mysql+pymysql://", self.mysql_url.strip())
            url = re.sub(r"^mysql\+mysqldb://", "mysql+pymysql://", url)
            if "charset=" not in url:
                sep = "&" if "?" in url else "?"
                url = f"{url}{sep}charset={self.db_charset}"
            return url

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
