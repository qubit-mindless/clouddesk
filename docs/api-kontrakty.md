# Kontrakty nowych endpointów (#142)

Uzgodnione kształty JSON dla pakietu #145: według nich Oskar pisze backend, a Adam UI. Frontend może pracować na udawanym API
(`VITE_FAKE_API=true`, `frontend/dev/fakeApi.ts`), które odpowiada dokładnie w tym formacie. Typy TypeScript:
`frontend/src/api/types.ts`; funkcje klienta: `src/api/stats.ts`, `src/api/health.ts`, `getTicketHistory` w `src/api/tickets.ts`.

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

## `POST /api/tickets/{id}/assistant/summary` – podsumowanie dla technika (#143) – **odłożone do v2.0**
Decyzja 25.11: bez implementacji w v1.0.0 (#143, etykieta `v2.0`). Kod klienta i udawanego API usunięty przy porządkach (#148);
kontrakt zostaje jako punkt wyjścia.

Role: TECHNICIAN, ADMIN; REPORTER (we własnym zgłoszeniu) → 403, cudze → 404. Ciało `{}`.
Raz na 5 minut na zgłoszenie – częściej → 429 z nagłówkiem `Retry-After` (sekundy).
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

## Pakiet z makiety (Mateusz, przed freeze 26.11)
Nowe elementy z zaakceptowanej makiety UI. Te same zasady co wyżej (camelCase, 401/403/404/422, widoczność jak przy zgłoszeniu).
**Dzień** liczymy w strefie Europe/Warsaw, jak w `/api/stats`.

### `POST /api/tickets/{id}/resolve` – „Pomogło – zamknij zgłoszenie”
Zgłaszający zamyka **własne** zgłoszenie po pomocy asystenta AI. Ciało `{}`. Zwraca `Ticket` (200).
- Tylko osoba zgłaszająca; technik i administrator zamykają przez `PATCH status` → 403. Cudze zgłoszenie → 404.
- Zgłoszenie już RESOLVED/CLOSED → 409.
- W zgłoszeniu nie ma jeszcze żadnej odpowiedzi asystenta (`ai_messages`, rola assistant) → 409 z komunikatem
  „Asystent AI nie odpowiadał jeszcze w tym zgłoszeniu – najpierw zapytaj asystenta. Gdy asystent jest wyłączony,
  zgłoszenie zamyka technik.” Przycisk „Pomogło” pokazujemy więc dopiero po pierwszej odpowiedzi asystenta.
- Kolejność sprawdzeń: 404 (nie istnieje / cudze) → 403 (technik, administrator) → 409 (zamknięte) → 409 (brak odpowiedzi AI).
- Skutek: `status = RESOLVED`, `resolvedAt = teraz`, w historii dwa wiersze z autorem = zgłaszający:
  `status` (stary → `RESOLVED`) i `resolution` (`null` → `SELF_AI`). Ten drugi pozwala policzyć „rozwiązane bez technika”.
- W osi historii (#139) pole `resolution` pokazujemy jako „zamknięte przez zgłaszającego po pomocy asystenta”.

### `GET /api/activity?limit=20` – „Aktywność na żywo”
Ostatnie zdarzenia w zgłoszeniach widocznych dla użytkownika (zgłaszający – tylko swoje). `limit` 1–50, domyślnie 20 → inaczej 422.
```json
{
  "items": [
    { "id": "h-412", "kind": "change", "ticketId": 3, "ticketTitle": "Nie działa VPN po aktualizacji",
      "actor": "tech.ola", "actorName": "Aleksandra Nowak", "field": "status", "oldValue": "ASSIGNED",
      "newValue": "IN_PROGRESS", "at": "2026-11-22T13:20:00Z" },
    { "id": "a-88", "kind": "ai", "ticketId": 18, "ticketTitle": "Drukarka na 2. piętrze nie drukuje",
      "actor": null, "actorName": "Asystent AI", "field": null, "oldValue": null, "newValue": null, "at": "…" },
    { "id": "t-55", "kind": "created", "ticketId": 55, "ticketTitle": "Teams: brak dźwięku", "actor": "ewa.z",
      "actorName": "Ewa Zielińska", "field": "priority", "oldValue": null, "newValue": "P3", "at": "…" }
  ]
}
```
- Źródła: `ticket_history` (`kind: change`, pola jak w #139, także `resolution`), utworzenie zgłoszenia
  (`kind: created`, `field: priority`, `newValue` = priorytet z chwili utworzenia: stara wartość pierwszej zmiany
  priorytetu w historii, a bez zmian – bieżący), odpowiedzi asystenta z `ai_messages` (`kind: ai`).
- `id` unikalne w obrębie listy: `h-` (id wiersza `ticket_history`), `t-` (id zgłoszenia), `a-` (id wiersza `ai_messages`).
- Sort: `at` malejąco; przy równym `at` najpierw `ai`, potem `change`, potem `created` (zdarzenia w kolejności, w jakiej
  zaszły, czytane od najnowszego); przy równym `at` i rodzaju – liczbowa część `id` malejąco (`h-10` przed `h-9`).
- Treści (opis, wiadomości AI) **nie** wracają – tylko tytuł zgłoszenia. Zmiana pola `description` ma `oldValue`
  i `newValue` = `null` (widać tylko, że opis zmieniono).

### `GET /api/notifications` i `POST /api/notifications/read` – dzwonek
Powiadomienia wyliczane z tych samych danych (bez osobnej tabeli). Pozycja jest nieprzeczytana (`unread: true`), gdy
`users.notifications_seen_at` jest `NULL` albo `at > notifications_seen_at` (ostro większe; nowa kolumna, migracja Alembic).
```json
{
  "unread": 2,
  "items": [
    { "id": "n-h-430", "kind": "assigned", "ticketId": 61, "ticketTitle": "Telefon VoIP nie loguje się do centrali",
      "actorName": "Jan Kowalski", "value": "tech.ola", "at": "…", "unread": true },
    { "id": "n-sla-12", "kind": "sla_breached", "ticketId": 12, "ticketTitle": "Awaria komputera w recepcji",
      "actorName": null, "value": "P1", "at": "…", "unread": false }
  ]
}
```
| `kind` | Kto dostaje | Kiedy (`at`) |
|---|---|---|
| `assigned` | technik, któremu ktoś **inny** przypisał zgłoszenie (`value` = jego login) | czas zmiany w historii |
| `new_p1` | technicy i administratorzy – zgłoszenie **utworzone** jako P1 (priorytet z chwili utworzenia jak w `/api/activity`; późniejsze podniesienie do P1 nie liczy się) (`value: "P1"`) | `createdAt` |
| `sla_breached` | technik przypisany do otwartego zgłoszenia po terminie; nieprzypisane – technicy i administratorzy | `slaDueAt` |
| `status` | zgłaszający, gdy ktoś **inny** zmienił status jego zgłoszenia (`value` = nowy status) | czas zmiany |
| `taken` | zgłaszający, gdy ktoś przypisał technika do jego zgłoszenia (`value` = login technika) | czas zmiany |

- Ostatnie 7 dni, najwyżej 20 pozycji, sort `at` malejąco (przy równym `at` – liczbowa część `id` malejąco).
  Własnych zmian nie powiadamiamy. `unread` w odpowiedzi = liczba nieprzeczytanych wśród zwróconych pozycji.
- Zgłaszający (REPORTER) dostaje wyłącznie `status` i `taken` ze swoich zgłoszeń; `assigned`, `new_p1` i `sla_breached`
  są tylko dla technika i administratora.
- `POST /api/notifications/read` – ciało `{}` (albo bez ciała) lub `{"until": "<ISO 8601 ze strefą>"}`, gdzie `until` = `at`
  najnowszego powiadomienia, które UI pokazało użytkownikowi. Serwer ustawia `notifications_seen_at = min(until, teraz)`
  (bez `until` – teraz; `until` z przyszłości przycinane do teraz) → 204. Znacznik się nie cofa: `until` starsze niż
  zapisany znacznik niczego nie zmienia. Powiadomienie nowsze niż `until` (przyszło po pobraniu listy) zostaje
  nieprzeczytane. Inne pola albo `until` bez strefy czasowej / nie-data → 422 (`loc: ["body", "until"]`).
  Obie ścieżki dla każdej zalogowanej roli.

### `GET /api/me/summary` – powitanie, liczniki i „Asystent AI dziś”
```json
{
  "mine": { "open": 4, "breached": 1, "atRisk": 1, "nextDueAt": "2026-11-22T15:12:00Z" },
  "team": { "breached": 2, "atRisk": 4, "createdToday": 5, "resolvedToday": 6,
            "last7Days": [{ "date": "2026-11-16", "created": 3, "resolved": 4 }] },
  "aiToday": { "conversations": 9, "resolvedByReporter": 3, "handedOver": 6, "answers": 14 }
}
```
- `mine` – technik/admin: przypisane do mnie i otwarte; zgłaszający: moje otwarte. `breached`/`atRisk` jak w `/api/stats`
  (`atRisk` = < 25% czasu SLA). `nextDueAt` – najbliższy termin SLA wśród `mine` przed terminem, `null` gdy brak.
- `team` i `aiToday` – tylko technik i admin; dla zgłaszającego `null`. `last7Days` – dokładnie 7 dni, ostatni = dziś.
- `aiToday.conversations` – zgłoszenia z odpowiedzią asystenta dziś; `resolvedByReporter` – z nich zamknięte dziś przez
  `/resolve` (`resolution = SELF_AI`) i **wciąż** RESOLVED/CLOSED (otwarte ponownie przez technika wracają do `handedOver`);
  `handedOver` = `conversations − resolvedByReporter`; `answers` – odpowiedzi dziś.

### `GET /api/stats` – porównanie z poprzednim okresem (dopisek do #138)
- `previous`: `{ "compliancePct": 70.8, "mttrHours": 41.8, "aiAnswers": 8 }` – te same definicje co `sla.compliancePct`,
  `mttrHours` i `ai.answers`, ale dla okresu tej samej długości tuż przed oknem: od początku dnia `days` dni przed
  `daily[0].date` do tej samej pory co „teraz” `days` dni wcześniej (bieżące okno też kończy się teraz – bez tego rano
  liczby z poprzedniego okresu byłyby zawsze większe). `compliancePct` i `mttrHours` = `null`, gdy wtedy nic nie rozwiązano.
- `openWeekAgo`: ile zgłoszeń było otwartych dokładnie 7 dni temu (teraz − 7 × 24 h), odtworzone z historii statusu:
  ostatnia zmiana statusu do tej chwili, a gdy wszystkie są późniejsze – stary status pierwszej z nich; zgłoszenie bez
  historii statusu (np. z seeda) jest liczone jako otwarte, jeśli nadal jest otwarte albo rozwiązano je później.
- UI: strzałki ↑↓ na kafelkach Otwarte, Zgodność, MTTR i Asystent AI (zielone = zmiana na lepsze).

### Konta demo na ekranie logowania
Bez nowego endpointu: przy `VITE_DEMO_ACCOUNTS=true` front pokazuje przyciski kont z seeda, które **wpisują e-mail**;
hasło trzeba podać. Logowanie jednym kliknięciem bez hasła na publicznej produkcji pozwoliłoby każdemu działać jako technik.

## Udawane API
- Dane demo: zgłoszenia z `src/mocks/tickets.json` przesunięte do „teraz” i 60 zgłoszeń z ostatnich 30 dni z historią
  (`dev/fakeDemo.ts`, stałe ziarno – po restarcie te same). Statystyki liczy `dev/fakeStats.ts` według definicji z tej strony.
- `PATCH` zapisuje historię zmian, przelicza SLA przy zmianie priorytetu, ustawia/zeruje `resolvedAt` i sprawdza `assignee`
  (tylko technik lub administrator) jak backend. `DELETE` usuwa też historię i rozmowę z asystentem.
