# Kontrakty nowych endpointów (#142)

Uzgodnione kształty JSON dla pakietu #145: według nich Oskar pisze backend, a Adam UI. Frontend może pracować na udawanym API
(`VITE_FAKE_API=true`, `frontend/dev/fakeApi.ts`), które odpowiada dokładnie w tym formacie. Typy TypeScript:
`frontend/src/api/types.ts`; funkcje klienta: `src/api/stats.ts`, `src/api/health.ts`, `getTicketHistory` w `src/api/tickets.ts`,
`summarizeConversation` w `src/api/assistant.ts`.

Wspólne zasady (jak w istniejących endpointach):
- JSON w camelCase (w Pythonie `CamelModel` z `app/schemas/ticket.py`), daty w ISO 8601 z UTC.
- Brak lub zły token → 401. Błędy walidacji → 422 w formacie FastAPI (`detail: [{loc, msg, type}]`).
- Zgłoszenie, którego użytkownik nie może zobaczyć (zgłaszający i cudze zgłoszenie), wygląda jak nieistniejące → 404.
- Wzorzec route → service → repository → DTO, test pytest dla każdej roli i wiersz w tabeli API w README przy implementacji.

Zmiana w istniejącym `Ticket`: frontend dostaje już od backendu `updatedAt` i `resolvedAt` (moment przejścia do RESOLVED/CLOSED,
`null` dla otwartych). Teraz są też w typie `Ticket`, bo korzystają z nich pulpit i pigułka SLA (#141).

## `GET /api/stats?days=30` – pulpit SLA (#138)
Role: TECHNICIAN, ADMIN; REPORTER → 403. `days`: liczba całkowita 7–90, domyślnie 30; poza zakresem → 422 (`loc: ["query", "days"]`).
Bez nowych tabel i migracji.

**Okno czasu** = `days` dni kalendarzowych w strefie Europe/Warsaw, od `daily[0].date` do dziś włącznie (w SQL np.
`(resolved_at AT TIME ZONE 'Europe/Warsaw')::date >= :start`). To samo okno dla `daily`, `sla.resolved`, `mttrHours` i `ai`,
żeby suma słupków zgadzała się z kafelkami.

```json
{
  "days": 30,
  "generatedAt": "2026-11-22T12:08:47Z",
  "byStatus": { "NEW": 3, "ASSIGNED": 3, "IN_PROGRESS": 6, "RESOLVED": 42, "CLOSED": 18 },
  "byPriority": { "P1": 3, "P2": 2, "P3": 2, "P4": 5 },
  "sla": { "open": 12, "breachedOpen": 3, "atRisk": 1, "resolved": 60, "resolvedOnTime": 45, "compliancePct": 75.0 },
  "mttrHours": 36.7,
  "perTechnician": [{ "login": "tech.ola", "fullName": "Aleksandra Nowak", "open": 5, "resolved": 30 }],
  "daily": [{ "date": "2026-10-24", "created": 2, "resolved": 1 }],
  "ai": { "answers": 14, "tickets": 6 },
  "atRiskTop": [{ "id": 3, "title": "…", "priority": "P1", "status": "IN_PROGRESS", "assignee": "tech.ola",
                  "createdAt": "…", "slaDueAt": "…" }]
}
```

| Pole | Definicja |
|---|---|
| `byStatus` | wszystkie zgłoszenia według bieżącego statusu (bez okna czasu); zawsze wszystkie 5 kluczy |
| `byPriority` | **otwarte** zgłoszenia (NEW/ASSIGNED/IN_PROGRESS) według priorytetu; zawsze 4 klucze |
| `sla.open` | otwarte teraz |
| `sla.breachedOpen` | otwarte, `slaDueAt <= teraz` |
| `sla.atRisk` | otwarte, przed terminem, zostało < 25% czasu SLA (ta sama reguła co `WARNING_RATIO` w `frontend/src/utils/sla.ts`) |
| `sla.resolved` | `resolvedAt` w oknie (RESOLVED i CLOSED) |
| `sla.resolvedOnTime` | z nich `resolvedAt <= slaDueAt` |
| `sla.compliancePct` | `resolvedOnTime / resolved * 100`, 1 miejsce po przecinku; `null`, gdy `resolved = 0`. **Liczone tylko z zakończonych** – otwarte po terminie są osobno w `breachedOpen` |
| `mttrHours` | średnia `resolvedAt − createdAt` w godzinach dla `sla.resolved`, 1 miejsce; `null`, gdy brak |
| `perTechnician` | każdy użytkownik z rolą TECHNICIAN: `open` – przypisane otwarte, `resolved` – przypisane i rozwiązane w oknie; sort: `open` malejąco, potem `login` |
| `daily` | **dokładnie `days` pozycji**, od najstarszej, ostatnia = dziś; `date` to dzień w strefie Europe/Warsaw (`YYYY-MM-DD`); `created` – utworzone tego dnia, `resolved` – z `resolvedAt` tego dnia; dni bez ruchu z zerami |
| `ai.answers` | odpowiedzi asystenta (`ai_messages`, rola assistant) z okna |
| `ai.tickets` | liczba zgłoszeń, w których jest co najmniej jedna taka odpowiedź |
| `atRiskTop` | do 5 otwartych zgłoszeń przekroczonych lub zagrożonych, sort `slaDueAt` rosnąco (przekroczone pierwsze) |

## `GET /api/tickets/{id}/history` – oś historii (#139)
Role: wszyscy zalogowani; widoczność jak `GET /api/tickets/{id}` (zgłaszający tylko swoje, cudze → 404). Dane z `ticket_history`.

```json
{
  "items": [
    { "id": 3, "field": "assignee", "oldValue": null, "newValue": "tech.ola",
      "author": "tech.ola", "authorName": "Aleksandra Nowak", "changedAt": "2026-11-09T19:47:35Z" },
    { "id": 4, "field": "status", "oldValue": "NEW", "newValue": "ASSIGNED",
      "author": "tech.ola", "authorName": "Aleksandra Nowak", "changedAt": "2026-11-09T19:47:35Z" }
  ]
}
```
- Kolejność: `changedAt` rosnąco, przy równym czasie `id` rosnąco.
- `field`: `status`, `priority`, `assignee`, `title`, `description`; wartości jak w bazie (statusy i priorytety jako kody, `assignee` jako login, `null` = brak).
- Utworzenia zgłoszenia nie ma w historii – UI bierze je z `createdAt` i `reporter` samego zgłoszenia.
- Zgłoszenie bez zmian → `{"items": []}`.

## `GET /api/health` – rozszerzenie dla strony `/status` (#140)
Publiczne, bez tokenu. Do obecnych pól (`status`, `database`, `version`, `commit`, `timestamp`) dochodzą:

| Pole | Skąd | Poza Azure |
|---|---|---|
| `revision` | zmienna `CONTAINER_APP_REVISION` (ustawia Container Apps) | `null` |
| `replica` | zmienna `CONTAINER_APP_REPLICA_NAME` | `null` |
| `region` | zmienna `APP_REGION` z Terraformu (`polandcentral`) | `null` |
| `startedAt` | czas startu procesu backendu | zawsze |
| `assistant` | `ENABLED`, gdy skonfigurowany endpoint Azure OpenAI, inaczej `DISABLED` – bez wywołania modelu | zawsze |

Przy awarii bazy dalej 503 z tym samym ciałem (`status: DOWN`, `database: DISCONNECTED`) – `getHealth()` we froncie zwraca je
zamiast rzucać błąd, żeby `/status` pokazało wersję i rewizję także wtedy. **Nie zwracamy:** nazwy hosta aplikacji,
domeny środowiska, adresów IP z VNet, nazw Key Vault/Storage, niczego z `DATABASE_URL`.

## `POST /api/tickets/{id}/assistant/summary` – podsumowanie dla technika (#143, opcjonalne)
Role: TECHNICIAN, ADMIN; REPORTER (we własnym zgłoszeniu) → 403, cudze → 404. Ciało `{}`.
Raz na 5 minut na zgłoszenie – częściej → 429 z nagłówkiem `Retry-After` (sekundy; we froncie `ApiError.retryAfterSeconds`).
Brak rozmowy zgłaszającego z asystentem → 409 (nie ma czego podsumować). AI wyłączone lub niedostępne → 503.

```json
{
  "problem": "Zgłaszający nie może zalogować się do VPN po aktualizacji systemu.",
  "checked": ["Ponowne uruchomienie komputera", "Inna sieć Wi-Fi"],
  "errors": ["Błąd uwierzytelnienia 809"],
  "nextStep": "Sprawdzić certyfikat VPN na koncie użytkownika.",
  "generatedAt": "2026-11-22T12:10:00Z"
}
```
Tekst bez Markdownu (`plain_text`), wejście z rozmowy przez `build_prompt` z losowym znacznikiem danych. Wynik nie jest
zapisywany – UI trzyma go w stanie strony.

## Udawane API
- Dane demo: zgłoszenia z `src/mocks/tickets.json` przesunięte do „teraz” i 60 zgłoszeń z ostatnich 30 dni z historią
  (`dev/fakeDemo.ts`, stałe ziarno – po restarcie te same). Statystyki liczy `dev/fakeStats.ts` według definicji z tej strony.
- `PATCH` zapisuje historię zmian, przelicza SLA przy zmianie priorytetu, ustawia/zeruje `resolvedAt` i sprawdza `assignee`
  (tylko technik lub administrator) jak backend. `DELETE` usuwa też historię i rozmowę z asystentem.
