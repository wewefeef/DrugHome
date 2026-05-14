from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0005_add_is_admin_to_users"
down_revision = "0004_normalize_14_tables"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    # Check if column already exists (added earlier by _repair_schema_if_needed)
    result = conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'is_admin'"
    ))
    if result.scalar() == 0:
        op.add_column(
            "users",
            sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
        )


def downgrade():
    op.drop_column("users", "is_admin")
