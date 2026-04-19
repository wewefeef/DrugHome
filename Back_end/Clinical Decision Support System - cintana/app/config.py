"""
Application configuration.
All settings are loaded from environment variables (via .env file).
"""

from pathlib import Path
from functools import lru_cache

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
    # Railway MySQL plugin injects MYSQL_URL (full connection string).
    # Fallback to individual vars for local development.
    mysql_url: str = ""          # full URL from Railway MySQL plugin (MYSQL_URL)
    database_url_env: str = ""   # generic DATABASE_URL (some providers use this)
    db_host: str = "127.0.0.1"
    db_port: int = 3306
    db_name: str = "cdss"
    db_user: str = "root"
    db_password: str = ""
    db_charset: str = "utf8mb4"

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
          1. MYSQL_URL  — injected by Railway MySQL plugin (mysql://...)
          2. DATABASE_URL — generic full URL
          3. Individual DB_* env vars — local development fallback
        """
        import re

        def _to_pymysql(url: str) -> str:
            """Ensure driver is mysql+pymysql and charset is appended."""
            url = re.sub(r"^mysql://", "mysql+pymysql://", url)
            url = re.sub(r"^mysql\+mysqldb://", "mysql+pymysql://", url)
            if "charset=" not in url:
                sep = "&" if "?" in url else "?"
                url = f"{url}{sep}charset={self.db_charset}"
            return url

        if self.mysql_url:
            return _to_pymysql(self.mysql_url)
        if self.database_url_env:
            return _to_pymysql(self.database_url_env)
        return (
            f"mysql+pymysql://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
            f"?charset={self.db_charset}"
        )


@lru_cache
def get_settings() -> Settings:
    """Return cached Settings instance (created once at startup)."""
    return Settings()
