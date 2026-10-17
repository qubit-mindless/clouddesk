# Roadmapa CloudDesk

Plan dostarczania projektu etapami. Każdy etap kończy się oddaniem sprawozdania: każdy członek zespołu wysyła własny PDF ze screenami i opisem swojego wkładu, do 23:59 w dniu terminu.

## Terminy
| Etap | Co dostarczamy | Termin |
|---|---|---|
| 01 | Zespół i role, deklaracja, repo, tablica Kanban, pierwszy szkic architektury | 10.10.2026 |
| 02 | Rozpisane i przypisane zadania, diagram 3-tier, struktura repo, README | 10.10.2026 |
| 03 | Subskrypcja Azure, konta zespołu z MFA, sieć i podsieci, NSG – w Terraformie | 24.10.2026 |
| 04 | Frontend: lista zgłoszeń na danych testowych, hosting w warstwie web | 24.10.2026 |
| 05 | Backend: API zgłoszeń z walidacją, PostgreSQL w podsieci prywatnej | 25.10.2026 |
| 06 | Frontend połączony z API, obsługa ładowania i błędów, dokumentacja API | 25.10.2026 |
| 07 | Pipeline CI: build, testy, skanowanie sekretów i podatności, ochrona main | 14.11.2026 |
| 08 | Automatyczny deploy do Azure po zielonym CI (OIDC) | 14.11.2026 |
| 09 | Hardening sieci, HTTPS z przekierowaniem, tabela reguł zapory w README | 28.11.2026 |
| 10 | Budżet i alerty kosztowe, `/health`, centralne logi, dashboard | 28.11.2026 |
| 11 | Testy API i E2E (Playwright) uruchamiane w CI | 29.11.2026 |
| 12 | Code freeze, poprawki, przypadki brzegowe, wydanie `v1.0.0-rc1` | 29.11.2026 |
| 13 | Dokumentacja końcowa: README, diagram w Mermaid, `.env.example`, porządki | 05.12.2026 |
| 14 | Próba generalna: demo na żywo, deploy na żywo, slajdy | 05.12.2026 |
| 15 | **Prezentacja końcowa i demo** | 06.12.2026 |

⚠️ Terminy idą parami, a 24–25.10 i 28–29.11 kumulują się po 4 etapy. Pracę techniczną kończymy tydzień wcześniej.

## Jak to zrobimy

**Etap 03: sieć.**
- Terraform w `terraform/` (provider `azurerm`), stan zdalny w Azure Storage.
- VNet `10.0.0.0/16` z podsieciami `snet-web` / `snet-app` / `snet-db`.
- Każda podsieć ma własną NSG, a ruch przechodzi tylko o jedną warstwę w dół.
- Konta w Entra ID z MFA i minimalnymi rolami.

**Etapy 04–06: aplikacja.**
- Zasób główny to `/api/tickets`. Potem dochodzą `/api/auth`, `/api/tickets/{id}/comments`, `/api/tickets/{id}/assistant` (czat AI) i `/api/tickets/{id}/attachments`.
- Backend: routery → serwisy → repozytoria, a dane wychodzą jako DTO (Pydantic). Migracje bazy w Alembic.
- Frontend:
  - stany ładowania, błędów i sukcesu;
  - walidacja formularzy przed wysłaniem;
  - `data-testid` na elementach używanych w testach.

**Etapy 07–08: CI/CD.**
- Jeden workflow: skany bezpieczeństwa → build i testy → deploy (tylko z `main`).
- Skanowanie: Gitleaks / GitHub Secret Scanning, Trivy, CodeQL, Dependabot.
- Logowanie do Azure przez OIDC (`azure/login`), bez stałych kluczy.
- Obrazy kontenerów trafiają do GHCR.

**Etapy 09–10: produkcja.**
- Baza i backend bez publicznego dostępu, SSH zamknięty.
- HTTPS na Nginx z certyfikatem i przekierowaniem 80 → 443.
- Budżet w Cost Management z alertami do całego zespołu.
- Logi w Log Analytics / Application Insights.

**Etapy 11–14: jakość i finał.**
- Testy API (pytest + httpx) i E2E (Playwright), z raportami jako artefaktami CI.
- Gałąź `release/v1.0.0`, tag `v1.0.0-rc1` i Release Notes.
- Dane demonstracyjne i nagranie zapasowe demo.

## Ustalenia techniczne zespołu
- Baza: **PostgreSQL 16**, port 5432.
- Backend: **FastAPI na porcie 8000**.
- Ścieżki API: `/api/<zasób w liczbie mnogiej>`.
- Chmura: **Azure for Students**. Region: `polandcentral` (asystent AI: `swedencentral`).
- Gotowych przykładów z sieci nie kopiujemy. Piszemy konfigurację pod nasz stos i sprawdzamy ją w dokumentacji narzędzi.
