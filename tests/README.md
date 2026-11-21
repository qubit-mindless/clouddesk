# Testy na działającej aplikacji

Projekt Node wspólny dla testów kontraktu API (Jest + Supertest) i testów E2E. Uzupełnia pytest z `backend/tests`: tam sprawdzamy kod backendu w izolacji, tu żywe API.

## Testy API (`api.test.js`)
Sprawdzają statusy (200/201/204/401/404/422), nagłówki (`Content-Type: application/json`, nagłówki bezpieczeństwa z Nginx), kształt odpowiedzi (`items/total/page/size`, typy pól zgłoszenia) i `/api/health`. Zgłoszenia utworzone w teście są usuwane na końcu, także gdy któryś test się nie powiedzie.

```bash
cd tests
npm ci

# Lokalnie: backend na http://localhost:8000 (domyślnie)
npm run test:api

# W chmurze, przez Nginx (sprawdza też nagłówki bezpieczeństwa); po wdrożeniu HTTPS (#85) – https://
LIVE_APP_URL=http://clouddesk-qubit.polandcentral.cloudapp.azure.com npm run test:api

# Z logowaniem (po #14): konto, które może tworzyć i usuwać zgłoszenia
TEST_USER_EMAIL=admin@clouddesk.example TEST_USER_PASSWORD=... npm run test:api
```

PowerShell: `$env:LIVE_APP_URL="..."; npm run test:api`.

| Zmienna | Domyślnie | Znaczenie |
|---|---|---|
| `LIVE_APP_URL` | `http://localhost:8000` | adres aplikacji |
| `TEST_USER_EMAIL`, `TEST_USER_PASSWORD` | puste | konto testowe; puste = testy bez tokenu, testy logowania pominięte |
| `CHECK_SECURITY_HEADERS` | `auto` | nagłówki dodaje Nginx: `auto` sprawdza je, gdy adres nie jest lokalny |

Hasła nie zapisujemy w repo ani w plikach – tylko w zmiennej środowiskowej (w CI jako sekret).
