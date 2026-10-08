# Deklaracja projektu (Blok 1 – E2)

**Nazwa grupy:** qubit-mindless

**Skład grupy:**
1. PM/DevOps – Nazwisko, Imię, Nr studenta: Fiebich Mateusz 94866
2. Frontend – Nazwisko, Imię, Nr studenta: Szymański Adam 89528
3. Backend – Nazwisko, Imię, Nr studenta: Ernst Oskar 96801
4. DBA – Nazwisko, Imię, Nr studenta: Radziszewski Bartosz _(indeks do uzupełnienia)_

**Nazwa projektu:** CloudDesk – system zgłoszeń IT z SLA i asystentem AI

**Opis projektu:**
CloudDesk to chmurowy helpdesk IT zgodny z cyklem życia incydentu ITIL. Pracownik zgłasza problem, a system nadaje priorytet (P1–P4) i odlicza czas SLA. Technicy prowadzą zgłoszenie przez statusy Nowe → Przypisane → W toku → Rozwiązane → Zamknięte, z pełną historią zmian. Zanim specjalista przejmie zgłoszenie, asystent AI (Azure OpenAI) analizuje opis problemu i proponuje rozwiązanie w czacie, więc część zgłoszeń rozwiązuje się bez angażowania technika. Aplikacja oferuje role (zgłaszający, technik, administrator), załączniki w Azure Blob Storage, powiadomienia e-mail oraz dashboard SLA.

**Chmura:** ☐ AWS ☒ Azure ☐ GCP

**Front-end:**
☒ React 19 + TypeScript (Vite)
☒ Nginx (warstwa WEB, reverse proxy)

**Back-end:**
☒ Python 3.12 + FastAPI (REST API, Pydantic DTO, wzorzec Repository)
☒ Azure Container Apps (ingress wewnętrzny, podsieć prywatna) + Azure OpenAI

**Baza danych:**
☒ PostgreSQL 16 – Azure Database for PostgreSQL Flexible Server (dostęp prywatny)
☒ SQLAlchemy 2 + Alembic (migracje)

**Infrastruktura i DevOps:** Terraform (azurerm), GitHub Actions (CI/CD, OIDC), Key Vault, Log Analytics / Application Insights

**Repozytorium GitHub (link):** https://github.com/qubit-mindless/clouddesk
