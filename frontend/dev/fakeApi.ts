import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

// Udawane API do pracy nad frontendem, zanim backend z #13 będzie gotowy. Działa tylko w `npm run dev`
// z VITE_FAKE_API=true, trzyma dane w pamięci (restart serwera je resetuje) i odpowiada jak FastAPI:
// te same ścieżki, statusy i format błędów 422.

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

const PRIORITIES = ['P1', 'P2', 'P3', 'P4']
const STATUSES = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']
const SLA_HOURS: Record<string, number> = { P1: 4, P2: 8, P3: 48, P4: 120 }
const DELAY_MS = 400

type FieldError = { loc: string[]; msg: string; type: string }

interface AssistantMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

const ASSISTANT_LIMIT = 10
const SUGGEST_PROMPT = 'Zaproponuj rozwiązanie problemu z tego zgłoszenia.'
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
  const mocksUrl = new URL('../src/mocks/tickets.json', import.meta.url)
  const tickets: Ticket[] = JSON.parse(readFileSync(mocksUrl, 'utf8'))
  let nextId = Math.max(...tickets.map((t) => t.id)) + 1
  const conversations = new Map<number, AssistantMessage[]>()
  let nextMessageId = 1

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
      server.config.logger.info('  ➜  Fake API: /api/tickets z danych testowych (VITE_FAKE_API=true)')
      server.middlewares.use('/api', async (req, res) => {
        await new Promise((r) => setTimeout(r, DELAY_MS))
        const url = new URL(req.url ?? '/', 'http://localhost')

        // Asystent AI: /tickets/{id}/assistant – ten sam kształt odpowiedzi co backend (#97).
        const assistant = url.pathname.match(/^\/tickets\/(\d+)\/assistant\/?$/)
        if (assistant) {
          const ticketId = Number(assistant[1])
          if (!tickets.some((t) => t.id === ticketId)) return send(res, 404, { detail: 'Ticket not found' })
          const items = conversations.get(ticketId) ?? []
          const answers = () => items.filter((m) => m.role === 'assistant').length
          const conversation = () => ({ items, enabled: true, remaining: Math.max(ASSISTANT_LIMIT - answers(), 0) })
          if (req.method === 'GET') return send(res, 200, conversation())
          if (req.method !== 'POST') return send(res, 405, { detail: 'Method Not Allowed' })

          const body = await readJson(req)
          if (!body) return send(res, 400, { detail: 'Invalid JSON' })
          const message = typeof body.message === 'string' ? body.message.trim() : undefined
          if ('message' in body && (!message || message.length > 1000)) {
            return send(res, 422, { detail: [{ loc: ['body', 'message'], msg: 'Wiadomość musi mieć 1–1000 znaków', type: 'value_error' }] })
          }
          if (answers() >= ASSISTANT_LIMIT) {
            return send(res, 429, { detail: 'Wyczerpano limit pytań do asystenta dla tego zgłoszenia.' })
          }
          const createdAt = new Date().toISOString()
          items.push({ id: nextMessageId++, role: 'user', content: message ?? SUGGEST_PROMPT, createdAt })
          items.push({ id: nextMessageId++, role: 'assistant', content: FAKE_ANSWER, createdAt })
          conversations.set(ticketId, items)
          return send(res, 200, conversation())
        }

        const match = url.pathname.match(/^\/tickets(?:\/(\d+))?\/?$/)
        if (!match) return send(res, 404, { detail: 'Not Found' })

        const id = match[1] ? Number(match[1]) : undefined
        const ticket = tickets.find((t) => t.id === id)
        if (id !== undefined && !ticket) return send(res, 404, { detail: 'Ticket not found' })

        if (req.method === 'GET' && !ticket) {
          const { status, priority, assignee } = Object.fromEntries(url.searchParams)
          const items = tickets.filter(
            (t) => (!status || t.status === status) && (!priority || t.priority === priority) && (!assignee || t.assignee === assignee),
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
            reporter: 'dev.user',
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
          const errors = validate(body, true)
          if (errors.length) return send(res, 422, { detail: errors })
          for (const key of ['title', 'description', 'priority', 'status', 'assignee'] as const) {
            if (key in body) Object.assign(ticket, { [key]: body[key] })
          }
          return send(res, 200, ticket)
        }

        if (req.method === 'DELETE' && ticket) {
          tickets.splice(tickets.indexOf(ticket), 1)
          return send(res, 204)
        }
        return send(res, 405, { detail: 'Method Not Allowed' })
      })
    },
  }
}
