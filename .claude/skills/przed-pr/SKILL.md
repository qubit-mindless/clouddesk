---
name: przed-pr
description: Sprawdzenie zmian przed otwarciem PR w CloudDesk – lint/testy/terraform dla zmienionych części, /code-review i /security-review według CLAUDE.md, wyniki gotowe do opisu PR. Użyj, gdy użytkownik wpisze /przed-pr albo poprosi o przygotowanie PR.
disable-model-invocation: true
---

# /przed-pr – zanim otworzysz Pull Request

Cel: PR, który przechodzi CI za pierwszym razem i ma w opisie to, czego oczekuje zespół (`CLAUDE.md` → „Przegląd przed PR”).

## 1. Co się zmieniło
```bash
git fetch -q origin
git diff --stat origin/main...HEAD
git status --short
```
Pracujesz na gałęzi od `main` (nie na `main`). Niezacommitowane zmiany – najpierw commit albo wyjaśnij użytkownikowi.

## 2. Sprawdzenia dla zmienionych części
Uruchom tylko te, których dotyczy diff. Każdy błąd popraw przed PR.

| Zmiana w | Sprawdzenie (jak w CI) |
|---|---|
| `backend/` | `cd backend && ruff check . && ruff format --check . && pytest` |
| `backend/alembic/` albo `backend/app/models/` | jak wyżej + test migracji na PostgreSQL 16, jeśli masz `TEST_DATABASE_URL` (`backend/.env.example`) |
| `frontend/` | `cd frontend && npm run lint && npm run build` |
| `tests/` | `cd tests && npm ci` + uruchomienie zmienionych testów na lokalnej aplikacji (`LIVE_APP_URL`, `tests/.env.example`) |
| `terraform/` | `terraform fmt -check -recursive` i `terraform validate` (do `validate` wystarczy `terraform init -backend=false`; bez dostępu do stanu `plan` robi PM/DevOps – w opisie PR podaj **oczekiwany** wynik planu) |
| `.github/workflows/` | składnia YAML, akcje przypięte po SHA z komentarzem wersji, minimalne `permissions`, sekrety tylko w krokach, które ich potrzebują |
| nowe zmienne środowiskowe | wpis w odpowiednim `.env.example` |
| endpointy API | tabela API w `README.md` |
| elementy UI w testach E2E | `data-testid` |

Nowe zależności i akcje: wersje wydane co najmniej 2 tygodnie temu.

## 3. Przeglądy (obowiązkowe)
- `/code-review` na diffie gałęzi. Potwierdzone błędy popraw; drobiazgi popraw albo uzasadnij.
- `/security-review` dodatkowo, gdy diff dotyka: logowania/ról/JWT, sekretów i `.env`, danych od użytkownika i zapytań do bazy, NSG / Nginx / HTTPS / nagłówków, `.github/workflows/`, `terraform/`, nowych zależności.
- Pomijasz tylko przy zmianach trywialnych: literówki, sama dokumentacja, formatowanie – i piszesz to w opisie PR.

## 4. Opis PR
- `Closes #N`, sekcje: **Co się zmienia**, **Sprawdzenie** (co i jak przetestowane, liczby), **Plan** (dla Terraformu – oczekiwany), **Przegląd** (1–2 zdania: co znalazły `/code-review` i `/security-review` i co poprawiono, co świadomie pominięto i dlaczego).
- Etykiety i milestone jak w issue.
- **Bez atrybucji AI** w commitach i opisie (bez `Co-Authored-By`, bez „Generated with”).
- PR zatwierdza inna osoba z zespołu – przegląd Claude'a nie zastępuje review.
