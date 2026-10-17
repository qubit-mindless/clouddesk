"""Dane testowe do lokalnej bazy (na wzór frontend/src/mocks/tickets.json).

Uruchomienie z katalogu backend/ po `alembic upgrade head`:
    python -m app.db.seed

Skrypt można puszczać wielokrotnie: użytkowników nie dubluje (po e-mailu),
a zgłoszenia dodaje tylko wtedy, gdy tabela tickets jest pusta.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models import Ticket, TicketPriority, TicketStatus, User, UserRole

# Login z frontendu = część e-maila przed "@".
# Domena .example jest zarezerwowana – to nie są prawdziwe adresy.
EMAIL_DOMAIN = "clouddesk.example"

USERS = [
    ("admin", "Administrator CloudDesk", UserRole.ADMIN),
    ("tech.jan", "Jan Kowalski", UserRole.TECHNICIAN),
    ("tech.ola", "Aleksandra Nowak", UserRole.TECHNICIAN),
    ("anna.k", "Anna Kaczmarek", UserRole.USER),
    ("piotr.m", "Piotr Mazur", UserRole.USER),
    ("ewa.z", "Ewa Zielińska", UserRole.USER),
    ("marek.w", "Marek Wójcik", UserRole.USER),
    ("kasia.l", "Katarzyna Lewandowska", UserRole.USER),
    ("tomasz.r", "Tomasz Rutkowski", UserRole.USER),
    ("hr.agnieszka", "Agnieszka Dąbrowska", UserRole.USER),
    ("jakub.s", "Jakub Szymczak", UserRole.USER),
]

# Czas na rozwiązanie wg priorytetu – tak jak w mockach frontendu.
SLA = {
    TicketPriority.P1: timedelta(hours=4),
    TicketPriority.P2: timedelta(hours=8),
    TicketPriority.P3: timedelta(days=2),
    TicketPriority.P4: timedelta(days=5),
}

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


def seed(db: Session) -> tuple[int, int]:
    """Zwraca (dodani użytkownicy, dodane zgłoszenia)."""
    existing = set(db.scalars(select(User.email)))
    new_users = [
        User(email=f"{login}@{EMAIL_DOMAIN}", full_name=name, role=role)
        for login, name, role in USERS
        if f"{login}@{EMAIL_DOMAIN}" not in existing
    ]
    db.add_all(new_users)
    db.flush()

    if db.scalar(select(func.count()).select_from(Ticket)):
        db.commit()
        return len(new_users), 0

    by_login = {u.email.split("@")[0]: u for u in db.scalars(select(User))}
    now = datetime.now(UTC)
    tickets = []
    for title, description, status, priority, reporter, assignee, hours_ago in TICKETS:
        created_at = now - timedelta(hours=hours_ago)
        tickets.append(
            Ticket(
                title=title,
                description=description,
                status=status,
                priority=priority,
                reporter=by_login[reporter],
                assignee=by_login[assignee] if assignee else None,
                created_at=created_at,
                sla_due_at=created_at + SLA[priority],
            )
        )
    db.add_all(tickets)
    db.commit()
    return len(new_users), len(tickets)


def main() -> None:
    with SessionLocal() as db:
        users, tickets = seed(db)
    print(f"Seed: dodano {users} użytkowników i {tickets} zgłoszeń.")


if __name__ == "__main__":
    main()
