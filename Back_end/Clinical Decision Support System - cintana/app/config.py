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

    # Railway MySQL plugin may inject one of several variable names depending
    # on plugin version. We capture all possibilities.
    database_url_env: str = Field(default="", validation_alias="DATABASE_URL")
    mysql_url_env: str = Field(default="", validation_alias="MYSQL_URL")
    # Individual Railway MySQL vars (MYSQLHOST style)
    mysqlhost: str = Field(default="", validation_alias="MYSQLHOST")
    mysqlport: str = Field(default="", validation_alias="MYSQLPORT")
    mysqldatabase: str = Field(default="", validation_alias="MYSQLDATABASE")
    mysqluser: str = Field(default="", validation_alias="MYSQLUSER")
    mysqlpassword: str = Field(default="", validation_alias="MYSQLPASSWORD")

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
          1. DATABASE_URL env var  (Railway auto-inject, some plugin versions)
          2. MYSQL_URL env var     (Railway MySQL plugin)
          3. MYSQLHOST + individual vars (Railway MySQL plugin)
          4. os.environ direct read (safety net bypassing pydantic cache)
          5. Local db_* fields
        """
        # 1. DATABASE_URL (via pydantic field)
        if self.database_url_env:
            return _to_pymysql(self.database_url_env)

        # 2. MYSQL_URL (via pydantic field)
        if self.mysql_url_env:
            return _to_pymysql(self.mysql_url_env)

        # 3. MYSQLHOST individual vars (via pydantic fields)
        if self.mysqlhost:
            port = int(self.mysqlport) if self.mysqlport else self.db_port
            db = self.mysqldatabase or self.db_name
            user = self.mysqluser or self.db_user
            pw = self.mysqlpassword or self.db_password
            return (
                f"mysql+pymysql://{user}:{pw}@{self.mysqlhost}:{port}/{db}"
                f"?charset={self.db_charset}"
            )

        # 4. Direct os.environ fallback (bypasses pydantic lru_cache issues)
        for key in ("DATABASE_URL", "MYSQL_URL", "MYSQL_PRIVATE_URL"):
            val = os.environ.get(key, "")
            if val:
                return _to_pymysql(val)

        for host_key in ("MYSQLHOST", "MYSQL_HOST"):
            host_val = os.environ.get(host_key, "")
            if host_val:
                port = int(os.environ.get("MYSQLPORT", os.environ.get("MYSQL_PORT", self.db_port)))
                db = os.environ.get("MYSQLDATABASE", os.environ.get("MYSQL_DATABASE", self.db_name))
                user = os.environ.get("MYSQLUSER", os.environ.get("MYSQL_USER", self.db_user))
                pw = os.environ.get("MYSQLPASSWORD", os.environ.get("MYSQL_PASSWORD", self.db_password))
                return (
                    f"mysql+pymysql://{user}:{pw}@{host_val}:{port}/{db}"
                    f"?charset={self.db_charset}"
                )

        # 5. Local fallback
        return (
            f"mysql+pymysql://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
            f"?charset={self.db_charset}"
        )


@lru_cache
def get_settings() -> Settings:
    """Return cached Settings instance (created once at startup)."""
    return Settings()
