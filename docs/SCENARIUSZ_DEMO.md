# Scenariusz prezentacji i demo (B14 próba generalna, B15 finał 6.12)

15 minut: wstęp → demo aplikacji → CI/CD na żywo → audyt i pytania. Zasada na demo: **nie zmieniamy infrastruktury ani schematu bazy**,
tylko warstwę prezentacji (jedna mała zmiana w UI przez CI/CD).

## Najważniejsze liczby (zmierzone 23.11)
| Co | Czas |
|---|---|
| Merge do `main` → start Deployu (CI na pushu) | ok. 1 min |
| Deploy: obraz 0,6 min → backend 1,8 min → frontend 1,8 min → testy API i E2E 0,6 min | 5–6 min |
| **Merge → nowa wersja frontu na produkcji** | **ok. 5–6 min** |
| Wybudzenie backendu ze skali 0 (pierwsze żądanie po przerwie) | zwykle 10–20 s, wyjątkowo do 60 s |

Wniosek: zmianę do CI/CD **scalamy w 1. minucie** (w trakcie wstępu). W części CI/CD (7.–10. min) pokazujemy zakończony przebieg
i nową wersję na produkcji – bez czekania na scenie.

## Przygotowanie
**Dzień wcześniej**
- [ ] Dane demo na produkcji (#137), testowe zgłoszenia usunięte („testy”, „Test izolacji bazy” itp.).
- [ ] PR z wersją pokazową gotowy i zielony, **nie scalony**: `frontend/src/config.ts` → etykieta wersji, np. `v1.0.0-LIVE-DEMO`
      (tylko warstwa prezentacji). Gałąź `demo/live-ci-cd`.
- [ ] Nagranie planu B (sekcja niżej) – plik na dysku prezentującego i w chmurze.
- [ ] Hasło kont demo pod ręką (Key Vault `demo-password`, `terraform output demo_password_hint`) – **nie na slajdach**.

**30 minut przed**
- [ ] Rozgrzać backend: `curl -s https://clouddesk-qubit.polandcentral.cloudapp.azure.com/api/health` (powtarzać co kilka minut do startu).
- [ ] `/status` – wszystkie warstwy zielone, region `polandcentral`, asystent `ENABLED`.
- [ ] Okna przeglądarki (osobne profile albo okna prywatne, żeby sesje się nie mieszały):
  1. **Anna Kaczmarek – Zgłaszający** (`anna.k@clouddesk.example`), widok „Moje zgłoszenia”;
  2. **Jan Kowalski – Technik** (`tech.jan@clouddesk.example`), lista zgłoszeń;
  3. **GitHub**: PR `demo/live-ci-cd` + zakładka Actions;
  4. **Portal Azure**: grupa `rg-clouddesk`, VNet, NSG, Log Analytics (gotowe zapytanie), budżet, dashboard.
- [ ] Animacja tła włączona (efekt), sprawdzony projektor w jasnym i ciemnym motywie.

**5 minut przed**
- [ ] `/api/health` 200 w < 1 s (backend nie śpi). Logowanie w obu oknach aktywne (token ważny 60 min – zalogować się na nowo).

## Scenariusz minuta po minucie
| Czas | Kto | Co pokazujemy | Co mówimy (w skrócie) |
|---|---|---|---|
| 0:00–0:30 | Mateusz | S1 – zespół i role | Cztery osoby, każda ma swoją warstwę. |
| **0:30** | Mateusz | **Merge PR `demo/live-ci-cd`** (jedno kliknięcie, okno 3) | „Wrócimy do tego za kilka minut – teraz pipeline pracuje sam.” |
| 0:30–2:00 | Mateusz | S2 problem i cel, S3 architektura (diagram z README) | Zgłoszenia giną w mailach; SLA i asystent AI; 3 warstwy, baza bez dostępu publicznego. |
| 2:00–3:30 | Adam | **Okno 1 (Anna):** „Zgłoś problem” → tytuł za krótki → błąd walidacji przy polu → poprawka → priorytet P1 → Wyślij | Walidacja po obu stronach; kafelki z czasem SLA. |
| 3:30–4:30 | Adam + Oskar | Asystent AI odpowiada od razu po wysłaniu; „Nie pomogło – czekam na technika” | Azure OpenAI przez tożsamość zarządzaną, bez kluczy; limit 10 odpowiedzi. Oskar: endpointy i role (403/404). |
| 4:30–6:00 | Adam | **Okno 2 (Jan):** nowe P1 na liście (odświeża się co 20 s), dzwonek „Nowe zgłoszenie P1”, liczniki, „Aktywność na żywo” | Technik widzi rozmowę z AI do odczytu – wie, co już sprawdzono. |
| 6:00–7:00 | Adam + Oskar | Szczegół zgłoszenia: przypisanie do siebie, status „W toku”, oś historii; filtr i wyszukiwanie; **usunięcie** zgłoszenia testowego; okno 1: Anna widzi „Zajmuje się tym Jan Kowalski” | Pełny CRUD i audyt zmian; zgłaszający widzi tylko swoje (cudze → 404). |
| 7:00–10:00 | Mateusz | **Okno 3:** zielony przebieg Deploy: obraz + Trivy → migracje → Container Apps → vm-web → testy API i E2E. **Okno 1:** odświeżenie → nowa wersja w stopce i na `/status` (SHA, rewizja) | CI: Gitleaks, Trivy, CodeQL, testy; CD przez OIDC bez haseł; testy na produkcji po każdym wdrożeniu. |
| 10:00–13:00 | Mateusz + Bartek | **Okno 4:** VNet i 3 podsieci, NSG (`DenyVnetInBound`, SSH zamknięty), PostgreSQL „dostęp publiczny: wyłączony”, Key Vault, Log Analytics (zapytanie o błędy), dashboard, budżet 50/80/100% | Bartek: model danych, migracje, codzienna kopia bazy. |
| 13:00–15:00 | wszyscy | Pytania | Każdy odpowiada ze swojego obszaru (niżej). |

Opcjonalnie (jeśli jest czas albo pytanie): **„Pomogło – zamknij”** na drugim zgłoszeniu Anny, pulpit SLA (`/dashboard`), limit logowania (429).

## Kto odpowiada na jakie pytania
| Obszar | Osoba | Gdzie są szczegóły |
|---|---|---|
| UI, dostępność, stany błędów, testy E2E | Adam | `frontend/`, `tests/e2e.spec.js` |
| API, walidacja, role, asystent AI, testy API | Oskar | `backend/app`, README → API |
| Baza, migracje, kopie, logi PostgreSQL | Bartek | `docs/database/ERD.md`, README → Monitoring |
| Azure, Terraform, sieć, CI/CD, koszty, bezpieczeństwo | Mateusz | `terraform/`, `.github/workflows/`, README → Bezpieczeństwo, FinOps |

## Plan B
| Co się psuje | Co robimy |
|---|---|
| Brak sieci albo awaria Azure | Nagranie całego scenariusza (niżej); architekturę i audyt pokazujemy na slajdach i w README. |
| Backend długo się budzi | Mówimy o skalowaniu do zera (świadomy kompromis kosztowy), w tym czasie pokazujemy `/status`. |
| Asystent AI nie odpowiada (503) | Pokazujemy komunikat błędu jako obsłużony stan i gotową rozmowę w zgłoszeniu z danych demo. |
| Deploy nie zdążył albo jest czerwony | Pokazujemy ostatni zielony przebieg i raport Playwright; wyjaśniamy, że czerwony test nie cofa wdrożenia. |
| Coś w UI nie działa na produkcji | Lokalnie z udawanym API: `cd frontend && VITE_FAKE_API=true VITE_DEMO_ACCOUNTS=true npm run dev` – te same ekrany bez backendu. |

**Nagranie planu B:** cały scenariusz 0:30–10:00 na produkcji, nagranie ekranu macOS (Cmd+Shift+5) albo OBS, 1080p, z dźwiękiem;
nagrywa Mateusz po próbie wewnętrznej, plik w zespołowym folderze w chmurze.

## Próba wewnętrzna (do śr. 2.12)
- [ ] Pełny przebieg ze stoperem – cel: ≤ 14 min (minuta zapasu na pytania prowadzącego w trakcie).
- [ ] Każdy mówi swoją część raz, bez czytania.
- [ ] Lista poprawek z próby → zadania z etykietą `bug`, poprawki do 4.12.
- [ ] Nagranie planu B.
- [ ] Screeny do PDF B14: aplikacja z HTTPS i Live URL, przed/po merge + zielone Actions, karta oceny po audycie.
