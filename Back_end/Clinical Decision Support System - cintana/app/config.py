"""
Application configuration.
All settings are loaded from environment variables (via .env file).
"""

import os
import re
from pathlib import Path
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL as _SA_URL


BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ───────────────────────────────────────────────────────────────────
    debug: bool = False
    app_title: str = "Clinical Decision Support System"
    app_version: str = "1.0.0"

    # ── Database local dev fallback ───────────────────────────────────────────
    # Railway URL is read directly via os.environ in database_url property
    # (bypasses pydantic-settings alias handling issues on Railway).
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
        Build SQLAlchemy connection string for MySQL via PyMySQL.

        All Railway env vars are read directly via os.environ to bypass
        any pydantic-settings alias / case-sensitivity issues on Linux.

        Priority (highest → lowest):
          1. DATABASE_URL  — Railway injects this when MySQL plugin is linked
                             (or set manually: DATABASE_URL = ${{MySQL.MYSQL_URL}})
          2. MYSQL_URL     — set manually in DrugHome Variables:
                             MYSQL_URL = ${{MySQL.MYSQL_URL}}
          3. MYSQLHOST     — individual vars (no underscore), some Railway templates
          4. db_host / ... — local development fallback (127.0.0.1)
        """
        def _fix(url: str) -> str:
            """Normalize any mysql:// variant to mysql+pymysql:// with charset."""
            url = url.strip()
            url = re.sub(r"^mysql://", "mysql+pymysql://", url)
            url = re.sub(r"^mysql\+mysqldb://", "mysql+pymysql://", url)
            if "charset=" not in url:
                sep = "&" if "?" in url else "?"
                url = f"{url}{sep}charset={self.db_charset}"
            return url

        # 1. DATABASE_URL — read directly, bypass pydantic-settings
        raw = os.environ.get("DATABASE_URL", "").strip()
        if raw:
            return _fix(raw)

        # 2. MYSQL_URL — manually set reference variable
        raw = os.environ.get("MYSQL_URL", "").strip()
        if raw:
            return _fix(raw)

        # 3. MYSQLHOST individual vars (no underscore, older Railway convention)
        mysqlhost = os.environ.get("MYSQLHOST", "").strip()
        if mysqlhost:
            try:
                port = int(os.environ.get("MYSQLPORT", "3306").strip() or "3306")
            except ValueError:
                port = 3306
            return _SA_URL.create(
                drivername="mysql+pymysql",
                username=os.environ.get("MYSQLUSER", self.db_user).strip(),
                password=os.environ.get("MYSQLPASSWORD", self.db_password).strip(),
                host=mysqlhost,
                port=port,
                database=os.environ.get("MYSQLDATABASE", self.db_name).strip(),
                query={"charset": self.db_charset},
            ).render_as_string(hide_password=False)

        # 4. Local dev fallback
        return (
            f"mysql+pymysql://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
            f"?charset={self.db_charset}"
        )


@lru_cache
def get_settings() -> Settings:
    """Return cached Settings instance (created once at startup)."""
    return Settings()
