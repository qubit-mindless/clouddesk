"""users.notifications_seen_at – kiedy użytkownik ostatnio przeczytał powiadomienia

Revision ID: e12a7dc46a3d
Revises: 3c1f9a7d2e45
Create Date: 2026-11-22 19:28:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e12a7dc46a3d"
down_revision: str | Sequence[str] | None = "3c1f9a7d2e45"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # NULL = użytkownik nie przeczytał jeszcze żadnego powiadomienia. Kolumna bez wartości domyślnej,
    # więc na PostgreSQL dodanie jej nie przepisuje tabeli.
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("notifications_seen_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("notifications_seen_at")
