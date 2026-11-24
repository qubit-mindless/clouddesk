// Testy kontraktu REST na działającej aplikacji (lokalnie albo w chmurze przez Nginx).
// Uzupełniają pytest z backend/tests: tam testujemy kod, tu żywe API – statusy, nagłówki i kształt JSON.
//
//   LIVE_APP_URL=http://localhost:5173 npm run test:api
//
// Zmienne opisuje tests/.env.example. Test sam usuwa zgłoszenia, które utworzył.

const request = require("supertest");
const { LIVE_APP_URL } = require("./helpers/env");

// Adres wspólny z E2E (helpers/env.js): lokalnie Vite z proxy /api, w chmurze Nginx.
const BASE_URL = LIVE_APP_URL.trim();
const EMAIL = (process.env.TEST_USER_EMAIL || "").trim();
const PASSWORD = process.env.TEST_USER_PASSWORD || "";
const AUTH_ENABLED = Boolean(EMAIL && PASSWORD);

// Nagłówki bezpieczeństwa dodaje Nginx – przy backendzie uruchomionym lokalnie ich nie ma.
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0", "host.docker.internal"];
const isLocal = LOCAL_HOSTS.includes(new URL(BASE_URL).hostname);

function checkHeadersSetting() {
  const value = (process.env.CHECK_SECURITY_HEADERS || "auto").trim().toLowerCase();
  if (value === "auto") return !isLocal;
  if (["true", "1", "yes"].includes(value)) return true;
  if (["false", "0", "no"].includes(value)) return false;
  throw new Error(`CHECK_SECURITY_HEADERS: nieznana wartość "${value}" (auto/true/false)`);
}
const CHECK_HEADERS = checkHeadersSetting();

// Backend w Container Apps skaluje się do zera – pierwsze żądanie czeka na zimny start.
jest.setTimeout(60_000);

const api = request(BASE_URL);
const JSON_TYPE = /^application\/json/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const STATUSES = ["NEW", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"];
const PRIORITIES = ["P1", "P2", "P3", "P4"];
// Dopasowanie w toEqual: tekst albo null.
const NULLABLE_STRING = {
  asymmetricMatch: (value) => value === null || typeof value === "string",
  toAsymmetricMatcher: () => "String | null",
};
// Id, którego na pewno nie ma (maksimum typu integer w PostgreSQL).
const MISSING_ID = 2147483647;
// Znacznik w tytule, żeby zgłoszenia z testów dało się rozpoznać, gdyby sprzątanie się nie udało.
const MARKER = `[api-test ${new Date().toISOString()}]`;

let token = null;
const createdIds = new Set();

const withAuth = (req) => (token ? req.set("Authorization", `Bearer ${token}`) : req);
const get = (path) => withAuth(api.get(path));
const post = (path, body) => withAuth(api.post(path).send(body));
const patch = (path, body) => withAuth(api.patch(path).send(body));
const del = (path) => withAuth(api.delete(path));

function expectTicketShape(ticket) {
  expect(ticket).toEqual(
    expect.objectContaining({
      id: expect.any(Number),
      title: expect.any(String),
      description: expect.any(String),
      reporter: expect.any(String),
      reporterName: expect.any(String),
      createdAt: expect.stringMatching(ISO_DATE),
      updatedAt: expect.stringMatching(ISO_DATE),
      slaDueAt: expect.stringMatching(ISO_DATE),
    }),
  );
  expect(STATUSES).toContain(ticket.status);
  expect(PRIORITIES).toContain(ticket.priority);
  expect(ticket.assignee === null || typeof ticket.assignee === "string").toBe(true);
  // Imię i nazwisko technika jest tylko wtedy, gdy zgłoszenie ma przypisanego technika.
  expect(ticket.assignee === null ? ticket.assigneeName === null : typeof ticket.assigneeName === "string").toBe(true);
  expect(ticket.resolvedAt === null || ISO_DATE.test(ticket.resolvedAt)).toBe(true);
}

function expectValidationError(res, field) {
  expect(res.status).toBe(422);
  expect(res.headers["content-type"]).toMatch(JSON_TYPE);
  expect(Array.isArray(res.body.detail)).toBe(true);
  if (field) {
    expect(res.body.detail.some((err) => err.loc.includes(field))).toBe(true);
  }
}

async function createTicket(overrides = {}) {
  const res = await post("/api/tickets", {
    title: `${MARKER} drukarka nie drukuje`,
    description: "Zgłoszenie utworzone przez testy API – zostanie usunięte.",
    priority: "P4",
    ...overrides,
  });
  if (res.status === 201) createdIds.add(res.body.id);
  return res;
}

const WARMUP_ATTEMPTS = 6;
const WARMUP_RESPONSE_MS = 20_000;
const WARMUP_PAUSE_MS = 5_000;

async function waitForApp() {
  let lastProblem;
  for (let attempt = 1; attempt <= WARMUP_ATTEMPTS; attempt += 1) {
    try {
      const res = await api.get("/api/health").timeout({ response: WARMUP_RESPONSE_MS });
      // Sam status 200 nie wystarczy: Nginx bez proxy /api odda index.html frontendu, też z 200.
      if (res.status === 200 && JSON_TYPE.test(res.headers["content-type"] || "") && res.body.status === "UP") {
        return;
      }
      lastProblem = `/api/health → ${res.status} ${res.headers["content-type"] || ""}`;
    } catch (err) {
      lastProblem = err.message;
    }
    if (attempt < WARMUP_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, WARMUP_PAUSE_MS));
  }
  throw new Error(`Aplikacja pod ${BASE_URL} nie odpowiada poprawnie: ${lastProblem}`);
}

// Rozgrzewka (zimny start po skalowaniu do zera) może trwać dłużej niż limit pojedynczego testu.
const WARMUP_TIMEOUT_MS = WARMUP_ATTEMPTS * (WARMUP_RESPONSE_MS + WARMUP_PAUSE_MS) + 30_000;

beforeAll(async () => {
  await waitForApp();
  if (AUTH_ENABLED) {
    const res = await api.post("/api/auth/login").send({ email: EMAIL, password: PASSWORD });
    if (res.status !== 200) throw new Error(`Logowanie konta testowego nie powiodło się: ${res.status}`);
    token = res.body.accessToken;
  }
}, WARMUP_TIMEOUT_MS);

afterAll(async () => {
  // Sprzątanie także wtedy, gdy któryś test przerwał się przed własnym DELETE.
  // Każde usunięcie osobno, żeby jeden błąd sieci nie zostawił reszty zgłoszeń.
  const leftovers = [];
  for (const id of createdIds) {
    try {
      const res = await del(`/api/tickets/${id}`);
      if (![204, 404].includes(res.status)) leftovers.push(`#${id} (${res.status})`);
    } catch (err) {
      leftovers.push(`#${id} (${err.message})`);
    }
  }
  if (leftovers.length) {
    throw new Error(`Nie udało się usunąć zgłoszeń testowych: ${leftovers.join(", ")} – usuń je ręcznie.`);
  }
});

describe("GET /api/health", () => {
  test("200, JSON ze stanem aplikacji i bazy", async () => {
    const res = await api.get("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(JSON_TYPE);
    expect(res.body).toEqual({
      status: "UP",
      database: "CONNECTED",
      version: expect.any(String),
      commit: expect.any(String),
      timestamp: expect.stringMatching(ISO_DATE),
      startedAt: expect.stringMatching(ISO_DATE),
      // Rewizja, replika i region Container Apps – poza Azure (lokalnie) null.
      revision: NULLABLE_STRING,
      replica: NULLABLE_STRING,
      region: NULLABLE_STRING,
      assistant: expect.stringMatching(/^(ENABLED|DISABLED)$/),
    });
  });

  (CHECK_HEADERS ? test : test.skip)("nagłówki bezpieczeństwa z Nginx", async () => {
    const res = await api.get("/api/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(res.headers.server || "").not.toMatch(/\d/); // server_tokens off – bez wersji Nginx
  });
});

(AUTH_ENABLED ? describe : describe.skip)("logowanie (JWT)", () => {
  test("bez tokenu → 401 z WWW-Authenticate: Bearer", async () => {
    const res = await api.get("/api/tickets");
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toMatch(/Bearer/i);
  });

  test("podrobiony token → 401", async () => {
    const res = await api.get("/api/tickets").set("Authorization", "Bearer abc.def.ghi");
    expect(res.status).toBe(401);
  });

  test("nieznane konto → 401, bez tokenu w odpowiedzi", async () => {
    // Nieistniejący e-mail zamiast złego hasła do konta testowego – nie nabijamy mu nieudanych logowań.
    // Backend zwraca ten sam 401 dla nieznanego e-maila i złego hasła.
    const res = await api
      .post("/api/auth/login")
      .send({ email: `nie-istnieje-${Date.now()}@clouddesk.example`, password: "zle-haslo" });
    expect(res.status).toBe(401);
    expect(res.body.accessToken).toBeUndefined();
  });

  test("brak hasła → 422", async () => {
    const res = await api.post("/api/auth/login").send({ email: EMAIL });
    expectValidationError(res, "password");
  });

  test("GET /api/auth/me → 200, dane konta testowego", async () => {
    const res = await get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(JSON_TYPE);
    expect(res.body.email).toBe(EMAIL.toLowerCase());
    expect(res.body).not.toHaveProperty("passwordHash");
  });
});

describe("GET /api/tickets", () => {
  test("200, strona wyników items/total/page/size", async () => {
    const res = await get("/api/tickets?page=1&size=5");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(JSON_TYPE);
    expect(res.body).toEqual({
      items: expect.any(Array),
      total: expect.any(Number),
      page: 1,
      size: 5,
    });
    expect(res.body.items.length).toBeLessThanOrEqual(5);
    res.body.items.forEach(expectTicketShape);
  });

  test.each([
    ["size=0", "size"],
    ["size=101", "size"],
    ["page=0", "page"],
    ["priority=P9", "priority"],
    ["status=OPEN", "status"],
  ])("nieprawidłowy filtr %s → 422", async (query, field) => {
    const res = await get(`/api/tickets?${query}`);
    expectValidationError(res, field);
  });

  test("nieistniejące zgłoszenie → 404", async () => {
    const res = await get(`/api/tickets/${MISSING_ID}`);
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(JSON_TYPE);
    expect(res.body.detail).toEqual(expect.any(String));
  });

  test("id, które nie jest liczbą → 422", async () => {
    const res = await get("/api/tickets/abc");
    expectValidationError(res, "ticket_id");
  });
});

describe("POST /api/tickets – walidacja", () => {
  test("za krótki tytuł → 422 przy polu title", async () => {
    const res = await createTicket({ title: "abc" });
    expectValidationError(res, "title");
  });

  test("nieznany priorytet → 422 przy polu priority", async () => {
    const res = await createTicket({ priority: "P0" });
    expectValidationError(res, "priority");
  });

  test("pole spoza kontraktu (status) → 422", async () => {
    const res = await createTicket({ status: "CLOSED" });
    expectValidationError(res, "status");
  });
});

describe("cykl życia zgłoszenia: POST → GET → PATCH → DELETE", () => {
  const title = `${MARKER} zażółć gęślą jaźń 🖨️`;
  let created;
  let ticket;

  // Zgłoszenie powstaje raz dla całego bloku – przy błędzie POST pozostałe testy kończą się jednym
  // czytelnym komunikatem zamiast „Cannot read properties of undefined”.
  beforeAll(async () => {
    created = await createTicket({ title });
    if (created.status !== 201) {
      throw new Error(`POST /api/tickets → ${created.status}: ${JSON.stringify(created.body)}`);
    }
    ticket = created.body;
  });

  test("POST → 201, status NEW i termin SLA nadany przez backend", () => {
    expect(created.headers["content-type"]).toMatch(JSON_TYPE);
    expectTicketShape(ticket);
    expect(ticket.status).toBe("NEW");
    expect(ticket.priority).toBe("P4");
    expect(ticket.title).toBe(title); // Unicode zapisuje się bez zmian
    expect(new Date(ticket.slaDueAt) > new Date(ticket.createdAt)).toBe(true);
  });

  test("GET /api/tickets/{id} → 200, te same dane", async () => {
    const res = await get(`/api/tickets/${ticket.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(ticket);
  });

  test("PATCH priorytetu → 200, SLA przeliczone", async () => {
    const res = await patch(`/api/tickets/${ticket.id}`, { priority: "P3" });
    expect(res.status).toBe(200);
    expectTicketShape(res.body);
    expect(res.body.priority).toBe("P3");
    // P3 ma krótszy termin niż P4 (2 dni zamiast 5).
    expect(new Date(res.body.slaDueAt) < new Date(ticket.slaDueAt)).toBe(true);
  });

  test("PATCH z nieznanym statusem → 422", async () => {
    const res = await patch(`/api/tickets/${ticket.id}`, { status: "DONE" });
    expectValidationError(res, "status");
  });

  test("DELETE → 204 bez treści", async () => {
    const res = await del(`/api/tickets/${ticket.id}`);
    expect(res.status).toBe(204);
    expect(res.text || "").toBe("");
    createdIds.delete(ticket.id);
  });

  test("po usunięciu: GET i DELETE → 404", async () => {
    expect((await get(`/api/tickets/${ticket.id}`)).status).toBe(404);
    expect((await del(`/api/tickets/${ticket.id}`)).status).toBe(404);
  });

  test("PATCH nieistniejącego zgłoszenia → 404", async () => {
    const res = await patch(`/api/tickets/${MISSING_ID}`, { priority: "P2" });
    expect(res.status).toBe(404);
  });
});
