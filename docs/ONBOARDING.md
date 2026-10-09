# Onboarding: nowy członek zespołu (i jego Claude)

Witaj w projekcie **CloudDesk**! Ten plik jest dla Ciebie i dla Twojego Claude'a. Przeczytaj go w całości, zanim zaczniesz pracę.

## 1. Kontekst w 30 sekund
- Projekt zespołowy na studiach (WSB Merito Wrocław): aplikacja w chmurze publicznej rozwijana przez cały semestr.
- Budujemy **CloudDesk**: helpdesk IT oparty na ITIL.
  - Zgłoszenia mają priorytet P1–P4 i termin SLA, a technicy prowadzą je przez kolejne statusy.
  - **Asystent AI (Azure OpenAI) pomaga zgłaszającemu, zanim przejmie go technik.**
- Architektura trójwarstwowa w **Azure**: Web (publiczna) → API (prywatna) → Baza (prywatna).
- Stos: React + TypeScript + Vite / Python FastAPI / PostgreSQL / Terraform / GitHub Actions.
- Ocenianych jest 14 etapów (każdy osobno, każdy musi mieć minimum 3.0) plus finał 06.12.2026.

## 2. Co przeczytać, w tej kolejności
1. [`README.md`](../README.md): opis, architektura, struktura repo, uruchomienie lokalne.
2. [`docs/ROADMAPA.md`](ROADMAPA.md): **etapy, terminy oddania** i ustalenia techniczne zespołu.
   Szczegółowe wymagania każdego etapu są w materiałach z zajęć (PDF-y z Moodle). Poproś o nie PM-a.
3. [`CLAUDE.md`](../CLAUDE.md): zasady kodu, których nie łamiemy.
4. [`docs/DEKLARACJA.md`](DEKLARACJA.md): oficjalna deklaracja projektu.
5. [Tablica Kanban](https://github.com/orgs/qubit-mindless/projects/1): kto co robi teraz.
6. [Kamienie milowe](https://github.com/qubit-mindless/clouddesk/milestones): zadania pogrupowane w bloki, z terminami.

## 3. Ustalenia, których nie zmieniamy bez rozmowy z zespołem
- Chmura **Azure for Students**, region `polandcentral` (asystent AI w `swedencentral`).
- Sieć: VNet `10.0.0.0/16`:
  - `snet-web` `10.0.1.0/24` (publiczna);
  - `snet-app` `10.0.2.0/24` (prywatna);
  - `snet-db` `10.0.3.0/24` (prywatna).
- Komponenty:
  - Web: VM z Nginx (frontend + reverse proxy `/api`);
  - API: Azure Container Apps z wewnętrznym ingressem;
  - Baza: PostgreSQL Flexible Server bez publicznego IP.
- Port backendu **8000**, baza **5432**, ścieżki API `/api/<zasób w liczbie mnogiej>`.
- Backend: routery → serwisy → repozytoria → modele. Na zewnątrz wychodzą tylko DTO (Pydantic).
- Konfiguracja wyłącznie przez zmienne środowiskowe. **Zero sekretów w repo** (włączona jest blokada pusha z sekretami).
- Repo jest publiczne, bo w darmowym planie tylko tak działa ochrona gałęzi i skanowanie sekretów.

## 4. Jak pracujemy w Git (main jest chroniony)
Nie da się wysłać zmian bezpośrednio do `main`. Każda zmiana przechodzi przez Pull Request:

```bash
git checkout main && git pull
git checkout -b feature/krotki-opis      # albo fix/issue-12, docs/..., infra/...
# ... praca, małe commity z sensownym opisem ...
git push -u origin feature/krotki-opis
gh pr create --fill                       # w opisie: "Closes #NR_ZADANIA"
```

Zasady:
- PR musi zatwierdzić **inna osoba** (1 approval), a dyskusje muszą być rozwiązane przed merge.
- `Closes #N` w opisie PR automatycznie zamyka zadanie po merge.
- Zadanie, które bierzesz, przesuwasz na tablicy do **In Progress**, a po otwarciu PR do **In Review**.
- W Issue lub PR możesz napisać komentarz `@claude …`, a Claude w GitHub Actions wykona zadanie albo zrobi review.

## 5. Pierwsze uruchomienie
Wymagania: Git, [GitHub CLI](https://cli.github.com/), Node.js 20+, Python 3.12+, Docker (dla lokalnej bazy).

```bash
gh auth login
gh repo clone qubit-mindless/clouddesk && cd clouddesk

# Sprawdź, czy wszystko działa:
cd backend && python -m venv .venv && source .venv/bin/activate \
  && pip install -r requirements-dev.txt && pytest && cd ..
cd frontend && npm install && npm run build && cd ..
```

Ustaw w tym repo swoją tożsamość commitów. Wtedy commity przypiszą się do Twojego konta, a prywatny mail się nie ujawni:

```bash
git config user.name "TWOJ_LOGIN_GITHUB"
git config user.email "$(gh api user --jq '.id')+$(gh api user --jq '.login')@users.noreply.github.com"
```

## 6. Sprawozdania: o tym nie zapominaj
Po każdym bloku **każdy z nas oddaje własny PDF** w Moodle:
- nazwa pliku: `BlokNN_Imie_Nazwisko_NrStudenta.pdf`;
- zawartość: punkty E1–E5, screeny i opis **Twojego** wkładu pod każdym punktem.

Rób screeny na bieżąco, w trakcie pracy, a nie na koniec. Spóźnienie albo brak opisu wkładu daje 2.0 i oznacza niezaliczenie przedmiotu.

## 7. Instrukcja dla Claude'a nowego członka zespołu
Jeśli jesteś Claude'em pomagającym członkowi zespołu:
1. Przeczytaj pliki z sekcji 2, a potem przejrzyj strukturę `frontend/` i `backend/`.
2. Sprawdź stan pracy:
   - `gh issue list -R qubit-mindless/clouddesk`;
   - `gh project item-list 1 --owner qubit-mindless`;
   - `gh pr list -R qubit-mindless/clouddesk`.
3. Zapytaj użytkownika, jaką ma rolę w zespole (Frontend / Backend / DBA), i pokaż mu zadania z jego etykiety oraz z najbliższego kamienia milowego.
4. Jeśli użytkownik ma PDF-y z zajęć, przeczytaj ten dla bieżącego etapu, zanim zaczniesz. **Nie kopiuj ich treści do repozytorium:** repo jest publiczne, a materiały dydaktyczne są własnością ich autora.
5. Pracuj zgodnie z `CLAUDE.md` i sekcją 4: gałąź, PR i review innej osoby. Nigdy nie wysyłaj zmian bezpośrednio do main.
6. Przy każdym zadaniu przypominaj o screenach do sprawozdania z bieżącego bloku.
