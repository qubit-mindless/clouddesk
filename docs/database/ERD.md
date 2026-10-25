# Model danych (ERD)

Schemat bazy PostgreSQL 16. Źródło prawdy to modele SQLAlchemy w `backend/app/models/` i migracje Alembica w `backend/alembic/versions/`. Ten diagram aktualizujemy razem z każdą migracją.

```mermaid
erDiagram
    users ||--o{ tickets : "zgłasza (reporter_id)"
    users |o--o{ tickets : "obsługuje (assignee_id)"
    tickets ||--o{ ticket_history : "ma historię"
    users ||--o{ ticket_history : "zmienia (changed_by)"
    tickets ||--o{ comments : "ma komentarze"
    users ||--o{ comments : "pisze (author_id)"
    tickets ||--o{ attachments : "ma załączniki"
    users ||--o{ attachments : "dodaje (uploaded_by)"
    tickets ||--o{ ai_messages : "czat z asystentem AI"

    users {
        int id PK
        varchar(255) email UK "unikalny"
        varchar(255) password_hash "tylko skrót hasła"
        varchar(200) full_name
        varchar(20) role "REPORTER | TECHNICIAN | ADMIN, domyślnie REPORTER"
        timestamptz created_at "domyślnie now()"
    }

    tickets {
        int id PK
        varchar(200) title
        text description
        varchar(20) status "NEW | ASSIGNED | IN_PROGRESS | RESOLVED | CLOSED, indeks"
        varchar(2) priority "P1 | P2 | P3 | P4, indeks"
        int reporter_id FK "→ users, RESTRICT, indeks"
        int assignee_id FK "→ users, NULL, SET NULL, indeks"
        timestamptz sla_due_at "termin SLA, indeks"
        timestamptz created_at "domyślnie now()"
        timestamptz updated_at "now(), aktualizowane przy zmianie"
        timestamptz resolved_at "NULL do rozwiązania"
    }

    ticket_history {
        int id PK
        int ticket_id FK "→ tickets, CASCADE, indeks"
        int changed_by FK "→ users, RESTRICT"
        varchar(50) field "np. status"
        text old_value "NULL"
        text new_value "NULL"
        timestamptz changed_at "domyślnie now()"
    }

    comments {
        int id PK
        int ticket_id FK "→ tickets, CASCADE, indeks"
        int author_id FK "→ users, RESTRICT"
        text body
        timestamptz created_at "domyślnie now()"
    }

    attachments {
        int id PK
        int ticket_id FK "→ tickets, CASCADE, indeks"
        int uploaded_by FK "→ users, RESTRICT"
        varchar(255) file_name
        varchar(1024) blob_url "plik w Azure Blob Storage"
        bigint size_bytes "CHECK >= 0"
        timestamptz created_at "domyślnie now()"
    }

    ai_messages {
        int id PK
        int ticket_id FK "→ tickets, CASCADE, indeks"
        varchar(20) role "user | assistant"
        text content
        timestamptz created_at "domyślnie now()"
    }
```

## Decyzje projektowe
- **Enumy jako `VARCHAR` + `CHECK`** (a nie natywny typ `ENUM` w PostgreSQL). Nowy status czy rola to prosta migracja zmieniająca constraint, a schemat działa też na SQLite w testach.
- **Daty ze strefą czasową** (`timestamptz`), zapisywane w UTC. Frontend dostaje je w ISO 8601 (`createdAt`, `slaDueAt`).
- **Usuwanie (`ON DELETE`):**
  - zgłoszenie pociąga za sobą swoją historię, komentarze, załączniki i czat AI (`CASCADE`);
  - użytkownika, który coś zgłosił, zmienił, skomentował lub dodał, nie da się usunąć (`RESTRICT`), bo audyt musi zostać kompletny;
  - usunięcie technika zwalnia jego zgłoszenia (`SET NULL` na `assignee_id`), które wracają do puli.
- **Indeksy:**
  - `status`, `priority`, `sla_due_at` dla filtrów i sortowania listy (np. „SLA zagrożone”);
  - `assignee_id` dla kolejki technika;
  - `reporter_id` dla widoku „moje zgłoszenia”;
  - `ticket_id` w tabelach zależnych dla widoku szczegółów zgłoszenia.
  PostgreSQL nie zakłada indeksów na kluczach obcych sam.
- **Hasła:** w bazie jest wyłącznie `password_hash`. Konta z danych testowych mają nieużywalny skrót `!`, więc nie da się na nie zalogować, dopóki moduł logowania nie ustawi hasła.
- **Nazwy constraintów** wynikają ze stałej konwencji (`pk_`, `uq_`, `fk_`, `ix_`, `ck_`; `app/models/base.py`), więc kolejne migracje mogą się do nich odwoływać po nazwie.

## Mapowanie na API (dla DTO)
| Kolumna | Pole JSON we frontendzie (`frontend/src/api/types.ts`) |
|---|---|
| `tickets.id`, `title`, `description`, `status`, `priority` | `id`, `title`, `description`, `status`, `priority` |
| `tickets.reporter_id` → `users` | `reporter` (login, np. `anna.k`) |
| `tickets.assignee_id` → `users` | `assignee` (login albo `null`) |
| `tickets.created_at` | `createdAt` |
| `tickets.sla_due_at` | `slaDueAt` |

Login w danych testowych (`backend/app/db/seed.py`) to część e-maila przed `@`. Ostateczny kształt DTO ustala backend w `app/schemas`.
