// Logowanie przez API (POST /api/auth/login, #94) → nagłówek Authorization do kolejnych żądań.
const request = require('supertest')
const { LIVE_APP_URL, testUser } = require('./env')

async function authHeader() {
  const res = await request(LIVE_APP_URL).post('/api/auth/login').send(testUser())
  if (res.status !== 200) {
    throw new Error(`Logowanie konta testowego nie powiodło się: HTTP ${res.status}`)
  }
  return { Authorization: `Bearer ${res.body.accessToken}` }
}

module.exports = { authHeader }
