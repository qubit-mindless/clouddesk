"""TEST Blok 7: indeks wyszukiwania po tytule (celowo błędny na PostgreSQL)

Revision ID: a1b2c3d4e5f6
Revises: be28de76363f
Create Date: 2026-11-07 10:20:00

"""

from collections.abc import Sequence

from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: str | Sequence[str] | None = "be28de76363f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Brak gin_trgm_ops: varchar nie ma domyślnej klasy operatorów dla GIN. SQLite ignoruje postgresql_using.
    op.create_index("ix_tickets_title_search", "tickets", ["title"], postgresql_using="gin")


def downgrade() -> None:
    op.drop_index("ix_tickets_title_search", table_name="tickets")
