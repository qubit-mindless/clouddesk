"""users.is_active – blokada konta przez administratora

Revision ID: 4a241eaf6a9f
Revises: e12a7dc46a3d
Create Date: 2026-11-26 19:40:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "4a241eaf6a9f"
down_revision: str | Sequence[str] | None = "e12a7dc46a3d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Istniejące konta zostają aktywne (server_default true). Na PostgreSQL 11+ stała wartość domyślna
    # nie przepisuje tabeli.
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("is_active")
