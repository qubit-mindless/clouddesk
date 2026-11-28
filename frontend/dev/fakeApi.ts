import { randomBytes, randomInt } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import type { HistoryField, Ticket, TicketPriority, TicketStatus, User, UserRole } from '../src/api/types.ts'
import { buildDemoData, CLOSED_STATUSES, slaDueAt } from './fakeDemo.ts'
import { computeActivity, computeMeSummary, computeNotifications } from './fakeMakieta.ts'
import { computeStats } from './fakeStats.ts'

// Udawane API do pracy nad frontendem bez backendu. Działa tylko w `npm run dev` z VITE_FAKE_API=true,
// trzyma dane w pamięci (restart serwera je resetuje) i odpowiada jak FastAPI: te same ścieżki, statusy
// i format błędów 422. Logowanie i role jak w kontrakcie z #106: konta demo z seeda backendu, dowolne
// niepuste hasło (to tylko makieta – prawdziwe hasło jest w Key Vault). Tokeny giną przy restarcie serwera,
// co pozwala sprawdzić wygaśnięcie sesji (401). Kontrakty nowych endpointów (#142): docs/api-kontrakty.md.

const USERS: User[] = (
  [
    ['admin', 'Administrator CloudDesk', 'ADMIN'],
    ['tech.jan', 'Jan Kowalski', 'TECHNICIAN'],
    ['tech.ola', 'Aleksandra Nowak', 'TECHNICIAN'],
    ['anna.k', 'Anna Kaczmarek', 'REPORTER'],
    ['piotr.m', 'Piotr Mazur', 'REPORTER'],
    ['ewa.z', 'Ewa Zielińska', 'REPORTER'],
    ['marek.w', 'Marek Wójcik', 'REPORTER'],
    ['kasia.l', 'Katarzyna Lewandowska', 'REPORTER'],
    ['tomasz.r', 'Tomasz Rutkowski', 'REPORTER'],
    ['hr.agnieszka', 'Agnieszka Dąbrowska', 'REPORTER'],
    ['jakub.s', 'Jakub Szymczak', 'REPORTER'],
  ] as const satisfies readonly (readonly [string, string, UserRole])[]
).map(([login, fullName, role], i): User => ({ id: i + 1, email: `${login}@clouddesk.example`, login, fullName, role }))

// Konta (panel administratora): stan blokady i data założenia; nowe konta dopisujemy do USERS.
const userMeta = new Map<number, { isActive: boolean; createdAt: string }>(
  USERS.map((u, i) => [u.id, { isActive: true, createdAt: new Date(Date.UTC(2026, 9, 3 + i)).toISOString() }]),
)
const userAdmin = (u: User) => ({ ...u, ...(userMeta.get(u.id) ?? { isActive: true, createdAt: new Date().toISOString() }) })
// Hasło tymczasowe jak w backendzie: 16 znaków (secrets.token_urlsafe(12)).
// Znaki hasła tymczasowego (bez łatwych do pomylenia: I, O, l, 0, 1).
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_'
const temporaryPassword = () => Array.from({ length: 16 }, () => CHARSET[randomInt(CHARSET.length)]).join('')

const TOKEN_TTL_S = 3600
// Pola, które może zmienić tylko technik lub administrator (nieznane klucze backend pomija).
const STAFF_ONLY = ['status', 'assignee']
const PRIORITIES = ['P1', 'P2', 'P3', 'P4']
const STATUSES = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']
const DELAY_MS = 400
const STATS_DAYS = { min: 7, max: 90, default: 30 }
const STARTED_AT = new Date().toISOString()

type FieldError = { loc: string[]; msg: string; type: string }

interface AssistantMessage {
  id: number
  role: 'user' | 'assistant'
  author: string | null
  content: string
  createdAt: string
}

const ASSISTANT_LIMIT = 10
const SUGGEST_PROMPT = 'Podpowiedz, co mogę sprawdzić samodzielnie, zanim technik zajmie się zgłoszeniem.'
const FAKE_ANSWER =
  'To odpowiedź udawanego asystenta (VITE_FAKE_API).\n\n1. Uruchom ponownie urządzenie lub aplikację.\n' +
  '2. Sprawdź połączenie z siecią firmową.\n3. Jeśli problem wraca, technik przejmie zgłoszenie.'

function validate(body: Record<string, unknown>, partial: boolean): FieldError[] {
  const errors: FieldError[] = []
  const err = (field: string, msg: string) => errors.push({ loc: ['body', field], msg, type: 'value_error' })

  if (!partial || 'title' in body) {
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (title.length < 5) err('title', 'String should have at least 5 characters')
    if (title.length > 200) err('title', 'String should have at most 200 characters')
  }
  if (!partial || 'description' in body) {
    const description = typeof body.description === 'string' ? body.description.trim() : ''
    if (description.length < 1) err('description', 'String should have at least 1 character')
    if (description.length > 5000) err('description', 'String should have at most 5000 characters')
  }
  if ((!partial || 'priority' in body) && !PRIORITIES.includes(body.priority as string)) {
    err('priority', "Input should be 'P1', 'P2', 'P3' or 'P4'")
  }
  if ('status' in body && !STATUSES.includes(body.status as string)) err('status', 'Invalid status')
  return errors
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      try {
        const body: unknown = JSON.parse(raw)
        resolve(body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null)
      } catch {
        resolve(null)
      }
    })
  })
}

export function fakeApi(): Plugin {
  const mocksUrl = new URL('./tickets.json', import.meta.url)
  const demo = buildDemoData(JSON.parse(readFileSync(mocksUrl, 'utf8')), USERS)
  const tickets = demo.tickets
  const history = demo.history
  let nextHistoryId = demo.nextHistoryId
  let nextId = Math.max(...tickets.map((t) => t.id)) + 1
  const conversations = new Map<number, AssistantMessage[]>()
  let nextMessageId = 1
  const sessions = new Map<string, User>()
  // Kiedy użytkownik ostatnio otworzył powiadomienia (POST /notifications/read).
  const notificationsSeen = new Map<string, number>()
  const store = { tickets, history, conversations, users: USERS }
  // Jak TicketOut w backendzie: obok loginów imię i nazwisko do wyświetlenia (w magazynie wyliczane przy odpowiedzi).
  const fullName = (login: string) => USERS.find((u) => u.login === login)?.fullName ?? login
  const dto = (t: Ticket) => ({ ...t, reporterName: fullName(t.reporter), assigneeName: t.assignee ? fullName(t.assignee) : null })

  const send = (res: ServerResponse, status: number, body?: unknown) => {
    res.statusCode = status
    if (body === undefined) return res.end()
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  }

  return {
    name: 'clouddesk-fake-api',
    apply: 'serve',
    configureServer(server) {
      server.config.logger.info('  ➜  Fake API: /api/auth i /api/tickets z danych testowych (VITE_FAKE_API=true)')
      server.middlewares.use('/api', async (req, res) => {
        await new Promise((r) => setTimeout(r, DELAY_MS))
        const url = new URL(req.url ?? '/', 'http://localhost')

        // /health jest publiczne jak w backendzie. Rewizja, replika i region w Azure przychodzą ze zmiennych
        // Container Apps i Terraformu – tu stałe wartości, żeby strona /status miała co pokazać.
        if (url.pathname === '/health' && req.method === 'GET') {
          return send(res, 200, {
            status: 'UP',
            database: 'CONNECTED',
            version: '1.0.0',
            commit: 'local',
            timestamp: new Date().toISOString(),
            revision: 'ca-clouddesk-backend--fake',
            replica: 'ca-clouddesk-backend--fake-0',
            region: 'polandcentral',
            startedAt: STARTED_AT,
            assistant: 'ENABLED',
          })
        }

        if (url.pathname === '/auth/login' && req.method === 'POST') {
          const body = await readJson(req)
          if (!body) return send(res, 400, { detail: 'Invalid JSON' })
          const errors: FieldError[] = []
          const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
          const password = typeof body.password === 'string' ? body.password : ''
          if (email.length < 3) errors.push({ loc: ['body', 'email'], msg: 'String should have at least 3 characters', type: 'string_too_short' })
          if (!password) errors.push({ loc: ['body', 'password'], msg: 'String should have at least 1 character', type: 'string_too_short' })
          if (password.length > 128) errors.push({ loc: ['body', 'password'], msg: 'String should have at most 128 characters', type: 'string_too_long' })
          if (errors.length) return send(res, 422, { detail: errors })
          const user = USERS.find((u) => u.email === email)
          if (!user) return send(res, 401, { detail: 'Nieprawidłowy e-mail lub hasło.' })
          if (userMeta.get(user.id)?.isActive === false) {
            return send(res, 403, { detail: 'Konto jest zablokowane. Skontaktuj się z administratorem.' })
          }
          const token = `fake.${user.id}.${randomBytes(12).toString('hex')}`
          sessions.set(token, user)
          return send(res, 200, { accessToken: token, tokenType: 'bearer', expiresIn: TOKEN_TTL_S, user })
        }

        // Wszystko poza logowaniem wymaga tokenu, jak w backendzie.
        const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
        const session = token ? sessions.get(token) : undefined
        // Jak w backendzie: konto czytane przy każdym żądaniu – zablokowane albo zmienione działa od razu.
        const actor = session && userMeta.get(session.id)?.isActive !== false ? USERS.find((u) => u.id === session.id) : undefined
        if (!actor) {
          res.setHeader('WWW-Authenticate', 'Bearer')
          return send(res, 401, { detail: 'Brak lub nieprawidłowy token.' })
        }
        const staff = actor.role !== 'REPORTER'

        if (url.pathname === '/auth/me' && req.method === 'GET') return send(res, 200, actor)

        // Zmiana własnego hasła. Udawane API nie zna haseł – „zle-haslo” udaje błędne obecne hasło.
        if (url.pathname === '/auth/password' && req.method === 'POST') {
          const body = await readJson(req)
          if (!body) return send(res, 400, { detail: 'Invalid JSON' })
          const current = typeof body.currentPassword === 'string' ? body.currentPassword : ''
          const next = typeof body.newPassword === 'string' ? body.newPassword : ''
          if (current === 'zle-haslo') {
            return send(res, 422, { detail: [{ loc: ['body', 'currentPassword'], msg: 'Nieprawidłowe obecne hasło.', type: 'value_error' }] })
          }
          if ([...next].length < 12 || [...next].length > 128 || next === current) {
            return send(res, 422, { detail: [{ loc: ['body', 'newPassword'], msg: 'Nowe hasło: 12–128 znaków, inne niż obecne.', type: 'value_error' }] })
          }
          return send(res, 204)
        }

        // Konta – tylko administrator (kontrakt: docs/api-kontrakty.md, „Konta”).
        const usersMatch = url.pathname.match(/^\/users(?:\/(\d+))?(\/reset-password)?\/?$/)
        if (usersMatch) {
          if (actor.role !== 'ADMIN') return send(res, 403, { detail: 'Konta może zarządzać tylko administrator.' })
          const id = usersMatch[1] ? Number(usersMatch[1]) : undefined
          const target = id !== undefined ? USERS.find((u) => u.id === id) : undefined
          if (id !== undefined && !target) return send(res, 404, { detail: 'Nie ma takiego konta.' })
          const activeAdmins = () => USERS.filter((u) => u.role === 'ADMIN' && userMeta.get(u.id)?.isActive !== false).length

          if (!id && req.method === 'GET') {
            const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
            const role = url.searchParams.get('role')
            const items = USERS.filter((u) => (!q || u.email.includes(q) || u.fullName.toLowerCase().includes(q)) && (!role || u.role === role))
              .sort((a, b) => a.fullName.localeCompare(b.fullName, 'pl') || a.id - b.id)
              .map(userAdmin)
            return send(res, 200, { items, total: items.length, page: 1, size: 100 })
          }
          if (!id && req.method === 'POST') {
            const body = await readJson(req)
            if (!body) return send(res, 400, { detail: 'Invalid JSON' })
            const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
            const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
            const errors: FieldError[] = []
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push({ loc: ['body', 'email'], msg: 'Podaj poprawny adres e-mail.', type: 'value_error' })
            if (fullName.length < 2 || fullName.length > 200) errors.push({ loc: ['body', 'fullName'], msg: 'Imię i nazwisko: 2–200 znaków.', type: 'value_error' })
            const role = body.role as UserRole
            if (!['REPORTER', 'TECHNICIAN', 'ADMIN'].includes(role)) errors.push({ loc: ['body', 'role'], msg: 'Nieznana rola.', type: 'enum' })
            if (errors.length) return send(res, 422, { detail: errors })
            if (USERS.some((u) => u.email === email)) return send(res, 409, { detail: 'Konto z tym adresem już istnieje.' })
            const user: User = { id: Math.max(...USERS.map((u) => u.id)) + 1, email, login: email.split('@')[0], fullName, role }
            USERS.push(user)
            userMeta.set(user.id, { isActive: true, createdAt: new Date().toISOString() })
            return send(res, 201, { user: userAdmin(user), temporaryPassword: temporaryPassword() })
          }
          if (target && usersMatch[2] && req.method === 'POST') return send(res, 200, { temporaryPassword: temporaryPassword() })
          if (target && !usersMatch[2] && req.method === 'PATCH') {
            const body = await readJson(req)
            if (!body || !Object.keys(body).length) return send(res, 422, { detail: [{ loc: ['body'], msg: 'Podaj co najmniej jedno pole.', type: 'value_error' }] })
            const self = target.id === actor.id
            const demotes = body.role !== undefined && body.role !== target.role && target.role === 'ADMIN'
            const blocks = body.isActive === false && userMeta.get(target.id)?.isActive !== false
            if (self && (demotes || blocks)) {
              return send(res, 409, { detail: 'Nie możesz odebrać sobie roli administratora ani zablokować własnego konta.' })
            }
            if (target.role === 'ADMIN' && (demotes || blocks) && activeAdmins() <= 1) {
              return send(res, 409, { detail: 'To ostatni aktywny administrator – najpierw nadaj tę rolę komuś innemu.' })
            }
            if (typeof body.fullName === 'string') target.fullName = body.fullName.trim()
            if (body.role) target.role = body.role as UserRole
            if (typeof body.isActive === 'boolean') userMeta.set(target.id, { ...userAdmin(target), isActive: body.isActive })
            return send(res, 200, userAdmin(target))
          }
          return send(res, 405, { detail: 'Method Not Allowed' })
        }

        // Pulpit SLA (#138): tylko technik i administrator.
        if (url.pathname === '/stats' && req.method === 'GET') {
          if (!staff) return send(res, 403, { detail: 'Pulpit jest dostępny dla technika i administratora.' })
          const raw = url.searchParams.get('days')
          const days = raw === null ? STATS_DAYS.default : Number(raw)
          if (!Number.isInteger(days) || days < STATS_DAYS.min || days > STATS_DAYS.max) {
            const msg = `Input should be an integer between ${STATS_DAYS.min} and ${STATS_DAYS.max}`
            return send(res, 422, { detail: [{ loc: ['query', 'days'], msg, type: 'value_error' }] })
          }
          const answers = new Map(
            [...conversations]
              .filter(([id]) => tickets.some((t) => t.id === id))
              .map(([id, items]) => [id, items.filter((m) => m.role === 'assistant').map((m) => m.createdAt)]),
          )
          return send(res, 200, computeStats(tickets, USERS, answers, days, history))
        }

        // Pakiet z makiety: aktywność, powiadomienia, podsumowanie użytkownika.
        if (url.pathname === '/activity' && req.method === 'GET') {
          const raw = url.searchParams.get('limit')
          const limit = raw === null ? 20 : Number(raw)
          if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
            return send(res, 422, { detail: [{ loc: ['query', 'limit'], msg: 'Input should be an integer between 1 and 50', type: 'value_error' }] })
          }
          return send(res, 200, { items: computeActivity(store, actor, limit) })
        }
        if (url.pathname === '/notifications' && req.method === 'GET') {
          return send(res, 200, computeNotifications(store, actor, notificationsSeen.get(actor.login)))
        }
        if (url.pathname === '/notifications/read' && req.method === 'POST') {
          // Jak backend: do czasu najnowszego pokazanego powiadomienia (przyszłość przycinamy do „teraz”).
          const body = (await readJson(req)) ?? {}
          const until = typeof body.until === 'string' ? Date.parse(body.until) : NaN
          const next = Number.isNaN(until) ? Date.now() : Math.min(until, Date.now())
          // Znacznik się nie cofa – stara karta przeglądarki nie oznaczy przeczytanych z powrotem jako nowe.
          notificationsSeen.set(actor.login, Math.max(next, notificationsSeen.get(actor.login) ?? 0))
          return send(res, 204)
        }
        if (url.pathname === '/me/summary' && req.method === 'GET') return send(res, 200, computeMeSummary(store, actor))

        // „Pomogło – zamknij”: tylko zgłaszający, we własnym, otwartym zgłoszeniu.
        const resolveMatch = url.pathname.match(/^\/tickets\/(\d+)\/resolve\/?$/)
        if (resolveMatch && req.method === 'POST') {
          const owner = tickets.find((t) => t.id === Number(resolveMatch[1]))
          if (!owner || (!staff && owner.reporter !== actor.login)) return send(res, 404, { detail: 'Ticket not found' })
          if (staff) return send(res, 403, { detail: 'Technik zamyka zgłoszenie przez zmianę statusu.' })
          if (CLOSED_STATUSES.includes(owner.status)) return send(res, 409, { detail: 'Zgłoszenie jest już rozwiązane lub zamknięte.' })
          if (!conversations.get(owner.id)?.some((m) => m.role === 'assistant')) {
            return send(res, 409, { detail: 'Najpierw zapytaj asystenta AI – bez jego odpowiedzi zgłoszenie zamyka technik.' })
          }
          const changedAt = new Date().toISOString()
          history.push({ id: nextHistoryId++, ticketId: owner.id, field: 'status', oldValue: owner.status, newValue: 'RESOLVED', author: actor.login, changedAt })
          history.push({ id: nextHistoryId++, ticketId: owner.id, field: 'resolution', oldValue: null, newValue: 'SELF_AI', author: actor.login, changedAt })
          Object.assign(owner, { status: 'RESOLVED', resolvedAt: changedAt, updatedAt: changedAt })
          return send(res, 200, dto(owner))
        }

        // Oś historii (#139): widoczność jak przy samym zgłoszeniu.
        const historyMatch = url.pathname.match(/^\/tickets\/(\d+)\/history\/?$/)
        if (historyMatch && req.method === 'GET') {
          const ticketId = Number(historyMatch[1])
          const owner = tickets.find((t) => t.id === ticketId)
          if (!owner || (!staff && owner.reporter !== actor.login)) return send(res, 404, { detail: 'Ticket not found' })
          const items = history
            .filter((h) => h.ticketId === ticketId)
            .sort((a, b) => a.changedAt.localeCompare(b.changedAt) || a.id - b.id)
            .map(({ id, field, oldValue, newValue, author, changedAt }) => {
              const authorName = USERS.find((u) => u.login === author)?.fullName ?? author
              return { id, field, oldValue, newValue, author, authorName, changedAt }
            })
          return send(res, 200, { items })
        }

        // Asystent AI: /tickets/{id}/assistant – ten sam kształt odpowiedzi co backend (#97).
        const assistant = url.pathname.match(/^\/tickets\/(\d+)\/assistant\/?$/)
        if (assistant) {
          const ticketId = Number(assistant[1])
          // Jak backend: zgłaszający widzi tylko swoje zgłoszenia, cudze wyglądają jak nieistniejące.
          const owner = tickets.find((t) => t.id === ticketId)
          if (!owner || (!staff && owner.reporter !== actor.login)) return send(res, 404, { detail: 'Ticket not found' })
          const items = conversations.get(ticketId) ?? []
          const answers = () => items.filter((m) => m.role === 'assistant').length
          // Jak backend: pyta tylko zgłaszający, do rozwiązania zgłoszenia; technik widzi rozmowę do odczytu.
          const readOnlyReason = owner.reporter !== actor.login ? 'not_reporter' : CLOSED_STATUSES.includes(owner.status) ? 'resolved' : null
          const conversation = () => ({
            items,
            enabled: true,
            remaining: Math.max(ASSISTANT_LIMIT - answers(), 0),
            canAsk: readOnlyReason === null,
            readOnlyReason,
          })
          if (req.method === 'GET') return send(res, 200, conversation())
          if (req.method !== 'POST') return send(res, 405, { detail: 'Method Not Allowed' })

          const body = await readJson(req)
          if (!body) return send(res, 400, { detail: 'Invalid JSON' })
          // Jak backend: brak pola albo null = prośba o pierwszą propozycję rozwiązania.
          const message = typeof body.message === 'string' ? body.message.trim() : undefined
          if (body.message != null && (!message || message.length > 1000)) {
            return send(res, 422, { detail: [{ loc: ['body', 'message'], msg: 'Wiadomość musi mieć 1–1000 znaków', type: 'value_error' }] })
          }
          if (readOnlyReason === 'not_reporter') {
            return send(res, 403, { detail: 'Do asystenta AI pisze tylko osoba zgłaszająca – pozostali widzą rozmowę do odczytu.' })
          }
          if (readOnlyReason === 'resolved') {
            return send(res, 409, { detail: 'Zgłoszenie jest rozwiązane – rozmowa z asystentem AI jest zamknięta.' })
          }
          if (answers() >= ASSISTANT_LIMIT) {
            return send(res, 429, { detail: 'Wyczerpano limit pytań do asystenta dla tego zgłoszenia.' })
          }
          const createdAt = new Date().toISOString()
          items.push({ id: nextMessageId++, role: 'user', author: actor.login, content: message ?? SUGGEST_PROMPT, createdAt })
          items.push({ id: nextMessageId++, role: 'assistant', author: null, content: FAKE_ANSWER, createdAt })
          conversations.set(ticketId, items)
          return send(res, 200, conversation())
        }

        const match = url.pathname.match(/^\/tickets(?:\/(\d+))?\/?$/)
        if (!match) return send(res, 404, { detail: 'Not Found' })

        const id = match[1] ? Number(match[1]) : undefined
        // Cudze zgłoszenie dla zgłaszającego wygląda jak nieistniejące.
        const ticket = tickets.find((t) => t.id === id && (staff || t.reporter === actor.login))
        if (id !== undefined && !ticket) return send(res, 404, { detail: 'Ticket not found' })

        if (req.method === 'GET' && !ticket) {
          const { status, priority, assignee, q } = Object.fromEntries(url.searchParams)
          // Strona jak w backendzie: od najnowszych, page od 1, size 1–100 (domyślnie 50), `total` – wszystkie pasujące.
          const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1)
          const size = Math.min(100, Math.max(1, Number(url.searchParams.get('size') ?? 50) || 50))
          const items = tickets
            .filter(
              (t) =>
                (staff || t.reporter === actor.login) &&
                (!status || t.status === status) &&
                (!priority || t.priority === priority) &&
                (!assignee || t.assignee === assignee) &&
                (!q || t.title.toLowerCase().includes(q.toLowerCase())),
            )
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
          return send(res, 200, { items: items.slice((page - 1) * size, page * size).map(dto), total: items.length, page, size })
        }
        if (req.method === 'GET' && ticket) return send(res, 200, dto(ticket))

        if (req.method === 'POST' && !ticket) {
          const body = await readJson(req)
          if (!body) return send(res, 400, { detail: 'Invalid JSON' })
          const errors = validate(body, false)
          if (errors.length) return send(res, 422, { detail: errors })

          const now = new Date().toISOString()
          const priority = body.priority as TicketPriority
          const created: Ticket = {
            id: nextId++,
            title: String(body.title).trim(),
            description: String(body.description).trim(),
            status: 'NEW',
            priority,
            reporter: actor.login,
            reporterName: actor.fullName,
            assignee: null,
            assigneeName: null,
            createdAt: now,
            updatedAt: now,
            slaDueAt: slaDueAt(now, priority),
            resolvedAt: null,
          }
          tickets.push(created)
          return send(res, 201, dto(created))
        }

        if (req.method === 'PATCH' && ticket) {
          const body = await readJson(req)
          if (!body) return send(res, 400, { detail: 'Invalid JSON' })
          // Jak w FastAPI: najpierw walidacja ciała (422), potem uprawnienia w serwisie (403).
          const errors = validate(body, true)
          // Jak schemat Pydantic: login 1–100 znaków albo null (null zwalnia zgłoszenie).
          const assignee = typeof body.assignee === 'string' ? body.assignee.trim() : body.assignee
          if ('assignee' in body && assignee !== null && (typeof assignee !== 'string' || !assignee || assignee.length > 100)) {
            errors.push({ loc: ['body', 'assignee'], msg: 'String should have 1–100 characters', type: 'value_error' })
          }
          if (errors.length) return send(res, 422, { detail: errors })
          if (!staff) {
            if (STAFF_ONLY.some((key) => key in body)) {
              return send(res, 403, { detail: 'Status i przypisanie zgłoszenia zmienia technik.' })
            }
            if (CLOSED_STATUSES.includes(ticket.status)) {
              return send(res, 403, { detail: 'Rozwiązanego lub zamkniętego zgłoszenia nie można już zmieniać.' })
            }
          }
          if (typeof assignee === 'string') {
            // Jak serwis backendu (po sprawdzeniu uprawnień): tylko istniejący technik lub administrator.
            const user = USERS.find((u) => u.login === assignee)
            const msg = !user ? `Nie ma użytkownika „${assignee}”.` : user.role === 'REPORTER' ? 'Zgłoszenie można przypisać tylko technikowi.' : null
            if (msg) return send(res, 422, { detail: [{ loc: ['body', 'assignee'], msg, type: 'value_error' }] })
          }
          // Jak backend: każda faktyczna zmiana pola trafia do historii z autorem; nowy priorytet przelicza SLA
          // od utworzenia, przejście do RESOLVED/CLOSED ustawia resolvedAt, ponowne otwarcie je zeruje.
          const changedAt = new Date().toISOString()
          let changed = false
          for (const field of ['assignee', 'title', 'description', 'priority', 'status'] as const satisfies HistoryField[]) {
            if (!(field in body)) continue
            const value = body[field] === null ? null : String(body[field]).trim()
            if (value === ticket[field]) continue
            history.push({ id: nextHistoryId++, ticketId: ticket.id, field, oldValue: ticket[field], newValue: value, author: actor.login, changedAt })
            changed = true
            if (field === 'priority') ticket.slaDueAt = slaDueAt(ticket.createdAt, value as TicketPriority)
            if (field === 'status') {
              const status = value as TicketStatus
              if (!CLOSED_STATUSES.includes(status)) ticket.resolvedAt = null
              else if (ticket.resolvedAt === null) ticket.resolvedAt = changedAt
            }
            Object.assign(ticket, { [field]: value })
          }
          if (changed) ticket.updatedAt = changedAt
          return send(res, 200, dto(ticket))
        }

        if (req.method === 'DELETE' && ticket) {
          if (!staff) return send(res, 403, { detail: 'Zgłoszenie może usunąć tylko technik lub administrator.' })
          tickets.splice(tickets.indexOf(ticket), 1)
          for (let i = history.length - 1; i >= 0; i--) if (history[i].ticketId === ticket.id) history.splice(i, 1)
          conversations.delete(ticket.id)
          return send(res, 204)
        }
        return send(res, 405, { detail: 'Method Not Allowed' })
      })
    },
  }
}
