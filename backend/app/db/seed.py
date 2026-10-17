"""Dane testowe do lokalnej bazy (na wzór frontend/src/mocks/tickets.json).

Uruchomienie z katalogu backend/ po `alembic upgrade head`:
    python -m app.db.seed

Skrypt można puszczać wielokrotnie: użytkowników nie dubluje (po e-mailu),
a zgłoszenia (z historią, komentarzami, załącznikami i czatem AI) dodaje tylko
wtedy, gdy tabela tickets jest pusta.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models import (
    AiMessage,
    AiMessageRole,
    Attachment,
    Comment,
    Ticket,
    TicketHistory,
    TicketPriority,
    TicketStatus,
    User,
    UserRole,
)

# Login z frontendu = część e-maila przed "@".
# Domena .example jest zarezerwowana – to nie są prawdziwe adresy.
EMAIL_DOMAIN = "clouddesk.example"

# Konta z seeda nie mają hasła: "!" nie jest poprawnym skrótem żadnego algorytmu,
# więc logowanie na nie zawsze się nie powiedzie. Hasła ustawia moduł logowania.
UNUSABLE_PASSWORD_HASH = "!"

USERS = [
    ("admin", "Administrator CloudDesk", UserRole.ADMIN),
    ("tech.jan", "Jan Kowalski", UserRole.TECHNICIAN),
    ("tech.ola", "Aleksandra Nowak", UserRole.TECHNICIAN),
    ("anna.k", "Anna Kaczmarek", UserRole.REPORTER),
    ("piotr.m", "Piotr Mazur", UserRole.REPORTER),
    ("ewa.z", "Ewa Zielińska", UserRole.REPORTER),
    ("marek.w", "Marek Wójcik", UserRole.REPORTER),
    ("kasia.l", "Katarzyna Lewandowska", UserRole.REPORTER),
    ("tomasz.r", "Tomasz Rutkowski", UserRole.REPORTER),
    ("hr.agnieszka", "Agnieszka Dąbrowska", UserRole.REPORTER),
    ("jakub.s", "Jakub Szymczak", UserRole.REPORTER),
]

# Czas na rozwiązanie wg priorytetu – tak jak w mockach frontendu.
SLA = {
    TicketPriority.P1: timedelta(hours=4),
    TicketPriority.P2: timedelta(hours=8),
    TicketPriority.P3: timedelta(days=2),
    TicketPriority.P4: timedelta(days=5),
}

# Kolejne statusy ITIL – historia zgłoszenia przechodzi je po kolei aż do bieżącego.
STATUS_FLOW = [
    TicketStatus.NEW,
    TicketStatus.ASSIGNED,
    TicketStatus.IN_PROGRESS,
    TicketStatus.RESOLVED,
    TicketStatus.CLOSED,
]

# (tytuł, opis, status, priorytet, zgłaszający, technik, ile godzin temu zgłoszono)
TICKETS = [
    (
        "Nie działa VPN po aktualizacji",
        "Po wczorajszej aktualizacji systemu klient VPN zwraca błąd uwierzytelnienia. "
        "Pracuję zdalnie i nie mam dostępu do zasobów firmowych.",
        TicketStatus.NEW, TicketPriority.P2, "anna.k", None, 2,
    ),
    (
        "Drukarka 2. piętro – zacięcie papieru",
        "Drukarka przy pokoju 214 sygnalizuje zacięcie papieru, mimo że podajnik jest pusty. "
        "Restart nie pomógł.",
        TicketStatus.ASSIGNED, TicketPriority.P4, "piotr.m", "tech.jan", 26,
    ),
    (
        "Brak dostępu do systemu ERP",
        "Cały dział księgowości dostaje komunikat o wygasłej licencji przy logowaniu do ERP. "
        "Blokuje to zamknięcie miesiąca.",
        TicketStatus.IN_PROGRESS, TicketPriority.P1, "ewa.z", "tech.ola", 3,
    ),
    (
        "Prośba o nowy monitor",
        "Obecny monitor miga i ma przebarwienia w lewym górnym rogu. Proszę o wymianę na model 27 cali.",
        TicketStatus.RESOLVED, TicketPriority.P3, "marek.w", "tech.jan", 96,
    ),
    (
        "Outlook nie synchronizuje kalendarza",
        "Spotkania dodane w telefonie nie pojawiają się w Outlooku na laptopie. "
        "Problem trwa od poniedziałku.",
        TicketStatus.ASSIGNED, TicketPriority.P3, "kasia.l", "tech.ola", 20,
    ),
    (
        "Awaria serwera plików",
        "Udział \\\\fs01\\projekty jest niedostępny dla wszystkich użytkowników. "
        "Zespół projektowy nie może pracować.",
        TicketStatus.IN_PROGRESS, TicketPriority.P1, "tomasz.r", "tech.jan", 5,
    ),
    (
        "Nowe konto dla pracownika",
        "Od 1 listopada dołącza do nas nowa osoba w dziale sprzedaży. "
        "Proszę o konto domenowe, skrzynkę pocztową i dostęp do CRM.",
        TicketStatus.NEW, TicketPriority.P4, "hr.agnieszka", None, 1,
    ),
    (
        "Wolne działanie laptopa",
        "Laptop uruchamia się kilka minut, a aplikacje biurowe często się zawieszają. "
        "Dysk jest prawie pełny.",
        TicketStatus.NEW, TicketPriority.P3, "jakub.s", None, 4,
    ),
]  # fmt: skip

# Numer zgłoszenia (1..8, kolejność z TICKETS) → dodatkowe dane.
COMMENTS = {
    3: [("tech.ola", "Licencja odnowiona u dostawcy, czekam na propagację klucza w ERP.")],
    6: [
        ("tomasz.r", "Czy jest szacowany czas naprawy? Mamy dziś oddanie projektu."),
        ("tech.jan", "Dysk w macierzy wymieniony, trwa odbudowa – ok. 1 godziny."),
    ],
}
AI_CHAT = {
    1: [
        (AiMessageRole.USER, "Klient VPN po aktualizacji zwraca błąd uwierzytelnienia."),
        (
            AiMessageRole.ASSISTANT,
            "Spróbuj usunąć zapisany profil VPN i zaimportować go ponownie, "
            "a potem zalogować się jeszcze raz. Sprawdź też, czy data i godzina w systemie są poprawne.",
        ),
        (AiMessageRole.USER, "Nie pomogło, nadal ten sam błąd."),
    ],
}
# W seedzie tylko ścieżka w kontenerze Blob Storage – bez adresu konta Storage.
ATTACHMENTS = {2: [("drukarka-214.jpg", "attachments/2/drukarka-214.jpg", 245_760)]}


def _history(ticket: Ticket, admin: User) -> list[TicketHistory]:
    """Wpisy audytu od NEW do bieżącego statusu, rozłożone w czasie od zgłoszenia."""
    steps = STATUS_FLOW[: STATUS_FLOW.index(ticket.status) + 1]
    entries = []
    for i, (old, new) in enumerate(zip(steps, steps[1:], strict=False), start=1):
        actor = admin if new == TicketStatus.ASSIGNED else ticket.assignee
        entries.append(
            TicketHistory(
                author=actor,
                field="status",
                old_value=old.value,
                new_value=new.value,
                changed_at=ticket.created_at + timedelta(minutes=30 * i),
            )
        )
    return entries


def seed(db: Session) -> dict[str, int]:
    """Zwraca liczbę dodanych rekordów w każdej tabeli."""
    added = dict.fromkeys(["users", "tickets", "ticket_history", "comments", "attachments", "ai_messages"], 0)
    existing = set(db.scalars(select(User.email)))
    new_users = [
        User(email=f"{login}@{EMAIL_DOMAIN}", password_hash=UNUSABLE_PASSWORD_HASH, full_name=name, role=role)
        for login, name, role in USERS
        if f"{login}@{EMAIL_DOMAIN}" not in existing
    ]
    db.add_all(new_users)
    db.flush()
    added["users"] = len(new_users)

    if db.scalar(select(func.count()).select_from(Ticket)):
        db.commit()
        return added

    by_login = {u.email.split("@")[0]: u for u in db.scalars(select(User))}
    now = datetime.now(UTC)
    for number, (title, description, status, priority, reporter, assignee, hours_ago) in enumerate(
        TICKETS, start=1
    ):
        created_at = now - timedelta(hours=hours_ago)
        ticket = Ticket(
            title=title,
            description=description,
            status=status,
            priority=priority,
            reporter=by_login[reporter],
            assignee=by_login[assignee] if assignee else None,
            created_at=created_at,
            sla_due_at=created_at + SLA[priority],
        )
        ticket.history = _history(ticket, by_login["admin"])
        if status in (TicketStatus.RESOLVED, TicketStatus.CLOSED):
            ticket.resolved_at = ticket.history[-1].changed_at
        ticket.comments = [
            Comment(author=by_login[login], body=body, created_at=now - timedelta(minutes=10 * (i + 1)))
            for i, (login, body) in enumerate(COMMENTS.get(number, []))
        ]
        ticket.ai_messages = [
            AiMessage(role=role, content=content, created_at=created_at + timedelta(minutes=i + 1))
            for i, (role, content) in enumerate(AI_CHAT.get(number, []))
        ]
        ticket.attachments = [
            Attachment(uploader=ticket.reporter, file_name=name, blob_url=blob, size_bytes=size)
            for name, blob, size in ATTACHMENTS.get(number, [])
        ]
        db.add(ticket)
        added["tickets"] += 1
        for key, rows in [
            ("ticket_history", ticket.history),
            ("comments", ticket.comments),
            ("attachments", ticket.attachments),
            ("ai_messages", ticket.ai_messages),
        ]:
            added[key] += len(rows)
    db.commit()
    return added


def main() -> None:
    with SessionLocal() as db:
        added = seed(db)
    print("Seed – dodano: " + ", ".join(f"{table}={count}" for table, count in added.items()))


if __name__ == "__main__":
    main()
