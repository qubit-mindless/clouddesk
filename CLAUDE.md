# CloudDesk – kontekst dla Claude

Projekt studencki (WSB Merito, „Projekt zespołowy: aplikacja w chmurze publicznej”): helpdesk IT z SLA i asystentem AI.
Oceniany w 14 blokach. Każdy blok ma checklistę E1–E5, którą prowadzący sprawdza na podstawie repo i screenshotów.

## Stos
- `frontend/`: React 19 + TypeScript + Vite. Lint: `npm run lint` (oxlint). Build: `npm run build`.
- `backend/`: Python 3.12 + FastAPI + SQLAlchemy 2 + Pydantic. Testy: `pytest`. Lint: `ruff check . && ruff format --check .`
- Baza: PostgreSQL 16 (lokalnie `config/docker-compose.yml`).
- Chmura: Azure (VNet 10.0.0.0/16: snet-web 10.0.1.0/24 public, snet-app 10.0.2.0/24 private, snet-db 10.0.3.0/24 private). IaC w `terraform/`.

## Zasady, których nie wolno łamać
- Architektura 3-tier: frontend nigdy nie łączy się z bazą. Backend nie ma publicznego IP. Baza przyjmuje ruch tylko z snet-app.
- Wzorce w backendzie: routery (`app/api/routes`) → serwisy (`app/services`) → repozytoria (`app/repositories`) → modele (`app/models`). Dane na zewnątrz wychodzą wyłącznie jako DTO z `app/schemas`.
- Zero sekretów, haseł i URL-i środowisk w kodzie. Wszystko przez zmienne środowiskowe. Każda nowa zmienna trafia do odpowiedniego `.env.example`.
- Każdy endpoint waliduje dane i zwraca poprawne statusy (200/201/204/400/404/422/500).
- Zmiany endpointów aktualizują tabelę API w README.md.
- Elementy UI używane w testach E2E dostają `data-testid`.
- Kod, komentarze, commity i opisy PR mogą być po polsku. Nazwy w kodzie są po angielsku.
