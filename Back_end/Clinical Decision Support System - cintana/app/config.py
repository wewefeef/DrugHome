"""
Application configuration.
All settings are loaded from environment variables (via .env file).
"""

import os
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

    # ── Database (MySQL) — fallback khi không có DATABASE_URL ─────────────────
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

    # ── CORS ──────────────────────────────────────────────────────────────────
    allowed_origins: str = "*"

    @property
    def database_url(self) -> str:
        """
        Ưu tiên theo thứ tự:
        1. DATABASE_URL (Railway reference var, nếu user tự set)
        2. MYSQLHOST + ... (Railway MySQL plugin tự inject)
        3. db_* fields trong .env (local dev)
        """
        # 1. DATABASE_URL dạng đầy đủ
        raw = os.environ.get("DATABASE_URL", "") or os.environ.get("MYSQL_URL", "")
        if raw:
            return raw.replace("mysql://", "mysql+pymysql://", 1)

        # 2. Railway MySQL plugin inject riêng lẻ
        mysql_host = os.environ.get("MYSQLHOST", "")
        if mysql_host:
            mysql_port = os.environ.get("MYSQLPORT", "3306")
            mysql_user = os.environ.get("MYSQLUSER", "root")
            mysql_pass = os.environ.get("MYSQLPASSWORD", "")
            mysql_db   = os.environ.get("MYSQLDATABASE", "railway")
            return (
                f"mysql+pymysql://{mysql_user}:{mysql_pass}"
                f"@{mysql_host}:{mysql_port}/{mysql_db}"
                f"?charset=utf8mb4"
            )

        # 3. Local dev fallback
        return (
            f"mysql+pymysql://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
            f"?charset={self.db_charset}"
        )


@lru_cache
def get_settings() -> Settings:
    """Return cached Settings instance (created once at startup)."""
    return Settings()
