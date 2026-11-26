"""Dane demo: ok. 90 zgłoszeń z ostatnich 30 dni z historią zmian (pulpit SLA, MTTR, trend, aktywność).

Uruchomienie z katalogu backend/ po `alembic upgrade head` i `python -m app.db.seed` (konta demo):
    python -m app.db.seed_demo
W Azure: `scripts/azure-migrate.sh --seed-demo`.

Generator jest deterministyczny (stałe ziarno), tak jak frontend/dev/fakeDemo.ts – zmienia się tylko
odniesienie do bieżącej chwili. Bez wywołań modelu AI: rozmowy z asystentem to gotowe teksty.
Idempotentny: gdy w bazie jest już co najmniej MIN_TICKETS zgłoszeń, nic nie dodaje. Próg liczy wszystkie
zgłoszenia (bez znacznika w schemacie), więc po ręcznym usunięciu części danych demo kolejne uruchomienie
może je dołożyć ponownie.
"""

import random
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import clock
from app.db.seed import EMAIL_DOMAIN
from app.db.session import SessionLocal
from app.models import (
    AiMessage,
    AiMessageRole,
    Comment,
    Ticket,
    TicketHistory,
    TicketPriority,
    TicketStatus,
    User,
    UserRole,
)
from app.services.ticket_service import (
    RESOLUTION_FIELD,
    RESOLUTION_SELF_AI,
    SLA_BY_PRIORITY,
)

DEMO_COUNT = 90
# Ostatnie zgłoszenia z ostatnich 3 godzin – na pulpicie są wtedy też nowe, czekające na przypisanie.
FRESH_COUNT = 5
# Próg idempotentności: przy tylu zgłoszeniach baza ma już dane demo (albo prawdziwy ruch) – nie dokładamy.
MIN_TICKETS = 60
WINDOW = timedelta(days=30)
SEED = 20261124

STATUS_FLOW = [
    TicketStatus.NEW,
    TicketStatus.ASSIGNED,
    TicketStatus.IN_PROGRESS,
    TicketStatus.RESOLVED,
    TicketStatus.CLOSED,
]

# (tytuł, opis) – typowe sprawy pierwszej linii wsparcia.
PROBLEMS = [
    (
        "Brak dostępu do folderu działu na dysku sieciowym",
        "Od rana nie mogę otworzyć folderu działu na dysku S:. Komunikat: odmowa dostępu.",
    ),
    (
        "Outlook nie synchronizuje kalendarza",
        "Spotkania dodane w telefonie nie pojawiają się w Outlooku na laptopie.",
    ),
    (
        "Laptop nie łączy się z Wi-Fi w sali konferencyjnej",
        "W sali 3.12 laptop widzi sieć firmową, ale połączenie kończy się błędem uwierzytelnienia.",
    ),
    ("Reset hasła do systemu kadrowego", "Hasło do systemu kadrowego wygasło, a link do zmiany nie działa."),
    (
        "Monitor zewnętrzny miga po podłączeniu do stacji dokującej",
        "Po podłączeniu laptopa do stacji dokującej monitor co kilka sekund gaśnie i zapala się.",
    ),
    (
        "Teams zawiesza się przy udostępnianiu ekranu",
        "Przy próbie udostępnienia ekranu w spotkaniu Teams aplikacja przestaje odpowiadać.",
    ),
    ("Prośba o instalację programu do PDF", "Potrzebuję programu do edycji i podpisywania plików PDF."),
    (
        "Drukarka sieciowa drukuje puste strony",
        "Drukarka przy recepcji wciąga papier, ale strony wychodzą puste. Toner wymieniony tydzień temu.",
    ),
    (
        "Konto zablokowane po kilku nieudanych logowaniach",
        "Po powrocie z urlopu kilka razy wpisałem stare hasło i konto się zablokowało.",
    ),
    (
        "Wolne działanie komputera po aktualizacji",
        "Od ostatniej aktualizacji system uruchamia się kilka minut, a przeglądarka często się zawiesza.",
    ),
    (
        "Nowy pracownik – założenie konta i skrzynki",
        "Od poniedziałku dołącza nowa osoba do działu sprzedaży. Proszę o konto, skrzynkę i dostęp do CRM.",
    ),
    ("Nie działa skaner na 1. piętrze", "Skaner przy pokoju 105 nie wysyła skanów na pocztę."),
    (
        "Błąd certyfikatu przy wejściu do intranetu",
        "Przeglądarka ostrzega, że certyfikat intranetu jest nieprawidłowy.",
    ),
    ("Brak dźwięku w słuchawkach USB", "Słuchawki USB są wykrywane, ale w rozmowach nie ma dźwięku."),
    (
        "Uprawnienia do edycji arkusza budżetu",
        "Proszę o uprawnienia do edycji arkusza budżetu działu na SharePoint.",
    ),
    ("Telefon służbowy nie odbiera poczty", "Aplikacja pocztowa w telefonie służbowym prosi ciągle o hasło."),
    (
        "VPN rozłącza się co kilkanaście minut",
        "Podczas pracy zdalnej połączenie VPN zrywa się co 10–15 minut.",
    ),
    (
        "Brak dostępu do systemu ERP",
        "Przy logowaniu do ERP pojawia się komunikat o braku licencji. Blokuje to fakturowanie.",
    ),
]  # fmt: skip

# Komentarze po przypisaniu: w trakcie obsługi i przy rozwiązanym zgłoszeniu.
COMMENTS_OPEN = [
    ("reporter", "Czy jest szacowany czas naprawy? Mam dziś ważne spotkanie."),
    ("assignee", "Sprawdzam zdalnie, proszę nie wyłączać komputera."),
]
COMMENTS_RESOLVED = [
    ("assignee", "Problem zdiagnozowany, wdrożyłem poprawkę."),
    ("reporter", "Dziękuję, już działa."),
]

# Rozmowy z asystentem AI – gotowe teksty (bez wywołań modelu).
AI_CHATS = [
    [
        (AiMessageRole.USER, "Podpowiedz, co mogę sprawdzić."),
        (
            AiMessageRole.ASSISTANT,
            "Uruchom ponownie komputer i sprawdź, czy problem wraca. Jeśli tak, zanotuj dokładny komunikat "
            "błędu i godzinę – technik szybciej znajdzie przyczynę w logach.",
        ),
    ],
    [
        (AiMessageRole.USER, "Podpowiedz, co mogę sprawdzić."),
        (
            AiMessageRole.ASSISTANT,
            "Sprawdź, czy kabel lub stacja dokująca są dobrze podłączone, i spróbuj innego portu. "
            "Zaktualizuj sterowniki z Centrum oprogramowania.",
        ),
        (AiMessageRole.USER, "Zmiana portu pomogła."),
        (
            AiMessageRole.ASSISTANT,
            "Świetnie. Jeśli problem wróci, dopisz w zgłoszeniu, który port nie działa – "
            "technik sprawdzi stację.",
        ),
    ],
    [
        (AiMessageRole.USER, "Co zrobić, zanim technik się odezwie?"),
        (
            AiMessageRole.ASSISTANT,
            "Wyloguj się i zaloguj ponownie, a potem wyczyść pamięć podręczną przeglądarki. "
            "Nie podawaj nikomu hasła – technik go nie potrzebuje.",
        ),
    ],
]


@dataclass
class _Plan:
    created: datetime
    priority: TicketPriority
    status: TicketStatus
    resolved: datetime | None


def _plan(rand: random.Random, now: datetime, fresh: bool) -> _Plan:
    roll = rand.random()
    priority = (
        TicketPriority.P1
        if roll < 0.1
        else TicketPriority.P2
        if roll < 0.35
        else TicketPriority.P3
        if roll < 0.75
        else TicketPriority.P4
    )
    created = now - (timedelta(hours=3) if fresh else WINDOW) * rand.random()
    sla = SLA_BY_PRIORITY[priority]
    # Ok. 1/5 kończy się po terminie SLA (mnożnik > 1) – inaczej pulpit pokazywałby wieczne 100%.
    resolved = created + sla * (0.15 + rand.random() * 1.1)
    if not fresh and resolved < now and rand.random() < 0.9:
        status = (
            TicketStatus.CLOSED
            if now - resolved > timedelta(days=3) and rand.random() < 0.5
            else TicketStatus.RESOLVED
        )
        return _Plan(created, priority, status, resolved)
    # Otwarte: tylko świeże (do 4 h) mogą jeszcze czekać na przypisanie, starsze są w obsłudze
    # (część z nich już po terminie SLA).
    status = rand.choice(
        [TicketStatus.NEW, TicketStatus.NEW, TicketStatus.ASSIGNED]
        if now - created < timedelta(hours=4)
        else [TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS, TicketStatus.IN_PROGRESS]
    )
    return _Plan(created, priority, status, None)


def _history(ticket: Ticket, plan: _Plan, admin: User, now: datetime, self_ai: bool) -> list[TicketHistory]:
    """Przypisanie i kolejne statusy aż do bieżącego – w tym samym formacie, w jakim zapisuje je API."""
    if plan.status == TicketStatus.NEW:
        return []
    end = plan.resolved or now
    span = end - plan.created
    times = [
        plan.created,
        plan.created + span * 0.1,
        plan.created + span * 0.3,
        end,
        min(end + timedelta(days=1), now),
    ]
    entries = [
        TicketHistory(
            author=admin,
            field="assignee",
            old_value=None,
            new_value=ticket.assignee.email.split("@")[0],
            changed_at=times[1],
        )
    ]
    last = STATUS_FLOW.index(plan.status)
    for step in range(1, last + 1):
        old, new = STATUS_FLOW[step - 1], STATUS_FLOW[step]
        author = admin if new == TicketStatus.ASSIGNED else ticket.assignee
        if new == TicketStatus.RESOLVED and self_ai:
            author = ticket.reporter
        entries.append(
            TicketHistory(
                author=author,
                field="status",
                old_value=old.value,
                new_value=new.value,
                changed_at=times[step],
            )
        )
        if new == TicketStatus.RESOLVED and self_ai:
            # „Pomogło – zamknij”: osobny wiersz liczony w /api/me/summary jako rozwiązane bez technika.
            entries.append(
                TicketHistory(
                    author=ticket.reporter,
                    field=RESOLUTION_FIELD,
                    old_value=None,
                    new_value=RESOLUTION_SELF_AI,
                    changed_at=times[step],
                )
            )
    return entries


def seed_demo(db: Session, now: datetime | None = None, count: int = DEMO_COUNT) -> dict[str, int]:
    """Dodaje dane demo i zwraca liczbę rekordów w każdej tabeli (same zera, gdy dane już są)."""
    added = dict.fromkeys(["tickets", "ticket_history", "comments", "ai_messages"], 0)
    if (db.scalar(select(func.count()).select_from(Ticket)) or 0) >= MIN_TICKETS:
        return added

    users = list(db.scalars(select(User).where(User.email.like(f"%@{EMAIL_DOMAIN}")).order_by(User.id)))
    by_role = {role: [u for u in users if u.role == role] for role in UserRole}
    admins = by_role[UserRole.ADMIN]
    technicians = by_role[UserRole.TECHNICIAN]
    reporters = by_role[UserRole.REPORTER]
    if not (admins and technicians and reporters):
        raise RuntimeError("Brak kont demo – najpierw uruchom `python -m app.db.seed`.")

    now = now or clock.utc_now()
    rand = random.Random(SEED)
    for i in range(count):
        plan = _plan(rand, now, fresh=i >= count - FRESH_COUNT)
        title, description = rand.choice(PROBLEMS)
        reporter = rand.choice(reporters)
        ticket = Ticket(
            title=title,
            description=description,
            status=plan.status,
            priority=plan.priority,
            reporter=reporter,
            assignee=None if plan.status == TicketStatus.NEW else rand.choice(technicians),
            created_at=plan.created,
            sla_due_at=plan.created + SLA_BY_PRIORITY[plan.priority],
            resolved_at=plan.resolved,
        )

        # Co szóste zgłoszenie ma rozmowę z asystentem; część z nich zgłaszający zamknął sam („Pomogło”).
        chat = rand.choice(AI_CHATS) if rand.random() < 1 / 6 else []
        if now - plan.created < timedelta(minutes=2 * len(chat)):
            chat = []  # zbyt świeże zgłoszenie – rozmowa miałaby wiadomości z przyszłości
        self_ai = bool(chat) and plan.status == TicketStatus.RESOLVED and rand.random() < 0.5
        ticket.ai_messages = [
            AiMessage(
                role=role,
                author=reporter if role == AiMessageRole.USER else None,
                content=content,
                created_at=plan.created + timedelta(minutes=2 * i + 1),
            )
            for i, (role, content) in enumerate(chat)
        ]
        ticket.history = _history(ticket, plan, admins[0], now, self_ai)

        # Bez komentarzy przy „Pomogło – zamknij” – to zgłoszenia rozwiązane bez technika.
        if ticket.assignee is not None and not self_ai and rand.random() < 0.3:
            # Między przypisaniem (pierwszy wpis historii) a rozwiązaniem albo bieżącą chwilą.
            assigned_at = ticket.history[0].changed_at
            end = plan.resolved or now
            pair = COMMENTS_RESOLVED if plan.resolved else COMMENTS_OPEN
            ticket.comments = [
                Comment(
                    author=reporter if who == "reporter" else ticket.assignee,
                    body=body,
                    created_at=assigned_at + (end - assigned_at) * (0.4 + 0.4 * i),
                )
                for i, (who, body) in enumerate(pair)
            ]

        # „Ostatnia zmiana” = najnowszy wpis historii (np. zamknięcie dzień po rozwiązaniu).
        ticket.updated_at = max([plan.created, *(h.changed_at for h in ticket.history)])
        db.add(ticket)
        added["tickets"] += 1
        added["ticket_history"] += len(ticket.history)
        added["comments"] += len(ticket.comments)
        added["ai_messages"] += len(ticket.ai_messages)
    db.commit()
    return added


def main() -> None:
    with SessionLocal() as db:
        added = seed_demo(db)
        total = db.scalar(select(func.count()).select_from(Ticket))
    if not any(added.values()):
        print(f"Seed demo – pominięto: w bazie jest {total} zgłoszeń (próg {MIN_TICKETS}).")
        return
    print("Seed demo – dodano: " + ", ".join(f"{table}={count}" for table, count in added.items()))


if __name__ == "__main__":
    main()
