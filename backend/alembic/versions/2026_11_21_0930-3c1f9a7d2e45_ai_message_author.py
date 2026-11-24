"""ai_messages.author_id – autor pytania do asystenta AI

Revision ID: 3c1f9a7d2e45
Revises: be28de76363f
Create Date: 2026-11-21 09:30:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "3c1f9a7d2e45"
down_revision: str | Sequence[str] | None = "be28de76363f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # batch_alter_table: SQLite (testy) nie umie dodać klucza obcego przez ALTER TABLE; na PostgreSQL
    # Alembic wykonuje zwykłe ALTER TABLE.
    with op.batch_alter_table("ai_messages") as batch:
        batch.add_column(sa.Column("author_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            op.f("fk_ai_messages_author_id_users"), "users", ["author_id"], ["id"], ondelete="SET NULL"
        )


def downgrade() -> None:
    with op.batch_alter_table("ai_messages") as batch:
        batch.drop_constraint(op.f("fk_ai_messages_author_id_users"), type_="foreignkey")
        batch.drop_column("author_id")
