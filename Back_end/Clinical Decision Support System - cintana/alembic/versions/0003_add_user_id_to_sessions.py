"""Add user_id foreign key to analysis_sessions

Revision ID: 0003_add_user_id_to_sessions
Revises: 0002_perf_indexes
Create Date: 2026-04-19

Changes
-------
analysis_sessions
  - ADD COLUMN  user_id INT NULL  (FK → users.id ON DELETE CASCADE)
  - ADD INDEX   ix_session_user   (user_id)
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0003_add_user_id_to_sessions"
down_revision = "0002_perf_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "analysis_sessions",
        sa.Column("user_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_session_user",
        "analysis_sessions", "users",
        ["user_id"], ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_session_user", "analysis_sessions", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_session_user", table_name="analysis_sessions")
    op.drop_constraint("fk_session_user", "analysis_sessions", type_="foreignkey")
    op.drop_column("analysis_sessions", "user_id")
