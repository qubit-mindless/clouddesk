import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import type { User, UserRole } from '../src/api/types.ts'

// Udawane API do pracy nad frontendem bez backendu. Działa tylko w `npm run dev` z VITE_FAKE_API=true,
// trzyma dane w pamięci (restart serwera je resetuje) i odpowiada jak FastAPI: te same ścieżki, statusy
// i format błędów 422. Logowanie i role jak w kontrakcie z #106: konta demo z seeda backendu, dowolne
// niepuste hasło (to tylko makieta – prawdziwe hasło jest w Key Vault). Tokeny giną przy restarcie serwera,
// co pozwala sprawdzić wygaśnięcie sesji (401).

interface Ticket {
  id: number
  title: string
  description: string
  status: string
  priority: string
  reporter: string
  assignee: string | null
  createdAt: string
  slaDueAt: string
}


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

const TOKEN_TTL_S = 3600
// Pola, które może zmienić tylko technik lub administrator (nieznane klucze backend pomija).
const STAFF_ONLY = ['status', 'assignee']
const CLOSED = ['RESOLVED', 'CLOSED']
const PRIORITIES = ['P1', 'P2', 'P3', 'P4']
const STATUSES = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']
const SLA_HOURS: Record<string, number> = { P1: 4, P2: 8, P3: 48, P4: 120 }
const DELAY_MS = 400

type FieldError = { loc: string[]; msg: string; type: string }

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
  const mocksUrl = new URL('../src/mocks/tickets.json', import.meta.url)
  const tickets: Ticket[] = JSON.parse(readFileSync(mocksUrl, 'utf8'))
  let nextId = Math.max(...tickets.map((t) => t.id)) + 1
  const sessions = new Map<string, User>()

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
          const token = `fake.${user.id}.${Math.random().toString(36).slice(2)}`
          sessions.set(token, user)
          return send(res, 200, { accessToken: token, tokenType: 'bearer', expiresIn: TOKEN_TTL_S, user })
        }

        // Wszystko poza logowaniem wymaga tokenu, jak w backendzie.
        const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
        const actor = token ? sessions.get(token) : undefined
        if (!actor) {
          res.setHeader('WWW-Authenticate', 'Bearer')
          return send(res, 401, { detail: 'Brak lub nieprawidłowy token.' })
        }
        const staff = actor.role !== 'REPORTER'

        if (url.pathname === '/auth/me' && req.method === 'GET') return send(res, 200, actor)

        const match = url.pathname.match(/^\/tickets(?:\/(\d+))?\/?$/)
        if (!match) return send(res, 404, { detail: 'Not Found' })

        const id = match[1] ? Number(match[1]) : undefined
        // Cudze zgłoszenie dla zgłaszającego wygląda jak nieistniejące.
        const ticket = tickets.find((t) => t.id === id && (staff || t.reporter === actor.login))
        if (id !== undefined && !ticket) return send(res, 404, { detail: 'Ticket not found' })

        if (req.method === 'GET' && !ticket) {
          const { status, priority, assignee } = Object.fromEntries(url.searchParams)
          const items = tickets.filter(
            (t) => (staff || t.reporter === actor.login) && (!status || t.status === status) && (!priority || t.priority === priority) && (!assignee || t.assignee === assignee),
          )
          return send(res, 200, items)
        }
        if (req.method === 'GET') return send(res, 200, ticket)

        if (req.method === 'POST' && !ticket) {
          const body = await readJson(req)
          if (!body) return send(res, 400, { detail: 'Invalid JSON' })
          const errors = validate(body, false)
          if (errors.length) return send(res, 422, { detail: errors })

          const now = new Date()
          const created: Ticket = {
            id: nextId++,
            title: String(body.title).trim(),
            description: String(body.description).trim(),
            status: 'NEW',
            priority: String(body.priority),
            reporter: actor.login,
            assignee: null,
            createdAt: now.toISOString(),
            slaDueAt: new Date(now.getTime() + SLA_HOURS[String(body.priority)] * 3_600_000).toISOString(),
          }
          tickets.push(created)
          return send(res, 201, created)
        }

        if (req.method === 'PATCH' && ticket) {
          const body = await readJson(req)
          if (!body) return send(res, 400, { detail: 'Invalid JSON' })
          // Jak w FastAPI: najpierw walidacja ciała (422), potem uprawnienia w serwisie (403).
          const errors = validate(body, true)
          if (errors.length) return send(res, 422, { detail: errors })
          if (!staff) {
            if (STAFF_ONLY.some((key) => key in body)) {
              return send(res, 403, { detail: 'Status i przypisanie zgłoszenia zmienia technik.' })
            }
            if (CLOSED.includes(ticket.status)) {
              return send(res, 403, { detail: 'Rozwiązanego lub zamkniętego zgłoszenia nie można już zmieniać.' })
            }
          }
          for (const key of ['title', 'description', 'priority', 'status', 'assignee'] as const) {
            if (key in body) Object.assign(ticket, { [key]: body[key] })
          }
          return send(res, 200, ticket)
        }

        if (req.method === 'DELETE' && ticket) {
          if (!staff) return send(res, 403, { detail: 'Zgłoszenie może usunąć tylko technik lub administrator.' })
          tickets.splice(tickets.indexOf(ticket), 1)
          return send(res, 204)
        }
        return send(res, 405, { detail: 'Method Not Allowed' })
      })
    },
  }
}
