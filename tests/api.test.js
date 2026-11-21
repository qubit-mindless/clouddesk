// Testy kontraktu REST na działającej aplikacji (lokalnie albo w chmurze przez Nginx).
// Uzupełniają pytest z backend/tests: tam testujemy kod, tu żywe API – statusy, nagłówki i kształt JSON.
//
//   LIVE_APP_URL=http://localhost:8000 npm run test:api
//
// Zmienne opisuje tests/.env.example. Test sam usuwa zgłoszenia, które utworzył.

const request = require("supertest");

const BASE_URL = (process.env.LIVE_APP_URL || "http://localhost:8000").replace(/\/+$/, "");
const EMAIL = process.env.TEST_USER_EMAIL || "";
const PASSWORD = process.env.TEST_USER_PASSWORD || "";
const AUTH_ENABLED = Boolean(EMAIL && PASSWORD);

const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE_URL);
const headersSetting = (process.env.CHECK_SECURITY_HEADERS || "auto").toLowerCase();
const CHECK_HEADERS = headersSetting === "auto" ? !isLocal : headersSetting === "true";

// Backend w Container Apps skaluje się do zera – pierwsze żądanie czeka na zimny start.
jest.setTimeout(60_000);

const api = request(BASE_URL);
const JSON_TYPE = /^application\/json/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const STATUSES = ["NEW", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"];
const PRIORITIES = ["P1", "P2", "P3", "P4"];
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
      createdAt: expect.stringMatching(ISO_DATE),
      updatedAt: expect.stringMatching(ISO_DATE),
      slaDueAt: expect.stringMatching(ISO_DATE),
    }),
  );
  expect(STATUSES).toContain(ticket.status);
  expect(PRIORITIES).toContain(ticket.priority);
  expect(ticket.assignee === null || typeof ticket.assignee === "string").toBe(true);
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

beforeAll(async () => {
  // Rozgrzewka: czekamy, aż backend odpowie (zimny start po skalowaniu do zera).
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const res = await api.get("/api/health").timeout({ response: 20_000 });
      if (res.status === 200) break;
      lastError = new Error(`/api/health → ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    if (attempt === 5) throw new Error(`Aplikacja pod ${BASE_URL} nie odpowiada: ${lastError}`);
  }

  if (AUTH_ENABLED) {
    const res = await api.post("/api/auth/login").send({ email: EMAIL, password: PASSWORD });
    if (res.status !== 200) throw new Error(`Logowanie konta testowego nie powiodło się: ${res.status}`);
    token = res.body.accessToken;
  }
});

afterAll(async () => {
  // Sprzątanie także wtedy, gdy któryś test przerwał się przed własnym DELETE.
  for (const id of createdIds) {
    await del(`/api/tickets/${id}`);
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

  test("złe hasło → 401, bez tokenu w odpowiedzi", async () => {
    const res = await api.post("/api/auth/login").send({ email: EMAIL, password: `${PASSWORD}-zle` });
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
  let ticket;

  test("POST → 201, status NEW i termin SLA nadany przez backend", async () => {
    const res = await createTicket({ title: `${MARKER} zażółć gęślą jaźń 🖨️` });
    expect(res.status).toBe(201);
    expect(res.headers["content-type"]).toMatch(JSON_TYPE);
    expectTicketShape(res.body);
    expect(res.body.status).toBe("NEW");
    expect(res.body.priority).toBe("P4");
    expect(res.body.title).toBe(`${MARKER} zażółć gęślą jaźń 🖨️`); // Unicode zapisuje się bez zmian
    expect(new Date(res.body.slaDueAt) > new Date(res.body.createdAt)).toBe(true);
    ticket = res.body;
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
