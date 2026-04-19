"""
Application configuration.
All settings are loaded from environment variables (via .env file).
"""

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
    # If set, it overrides the individual db_* fields above.
    database_url_env: str = Field(default="", validation_alias="DATABASE_URL")

    # ── Paths ─────────────────────────────────────────────────────────────────
    templates_dir: Path = BASE_DIR / "drugs" / "templates"
    static_dir: Path = BASE_DIR / "static"

    # ── Cache ─────────────────────────────────────────────────────────────────
    cache_ttl: int = 300  # seconds

    # ── Security ──────────────────────────────────────────────────────────────
    secret_key: str = "change-me-in-production-use-a-long-random-string"

    # ── CORS ──────────────────────────────────────────────────────────────────
    # Comma-separated list of allowed origins, or "*" to allow all.
    # Example: "https://yourdomain.com,https://www.yourdomain.com"
    allowed_origins: str = "*"

    @property
    def database_url(self) -> str:
        """
        SQLAlchemy connection string for MySQL using PyMySQL driver.
        If DATABASE_URL env var is set (Railway), uses that.
        Otherwise constructs from individual db_* fields.
        """
        if self.database_url_env:
            # Railway provides mysql:// — SQLAlchemy needs mysql+pymysql://
            # Only replace if not already using pymysql driver
            url = self.database_url_env
            if "mysql+pymysql://" not in url:
                url = url.replace("mysql://", "mysql+pymysql://", 1)
            return url
        return (
            f"mysql+pymysql://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
            f"?charset={self.db_charset}"
        )


@lru_cache
def get_settings() -> Settings:
    """Return cached Settings instance (created once at startup)."""
    return Settings()
