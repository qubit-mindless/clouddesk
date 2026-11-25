// Test dymny API: aplikacja odpowiada, a /api/health zgłasza działającą bazę. Testy kontraktu API: #98 (PR #117).
const request = require('supertest')
const { LIVE_APP_URL } = require('./helpers/env')

describe('GET /api/health', () => {
  it('zwraca 200, JSON i stan UP z połączoną bazą', async () => {
    const res = await request(LIVE_APP_URL).get('/api/health').expect('Content-Type', /json/).expect(200)
    expect(res.body).toMatchObject({ status: 'UP', database: 'CONNECTED' })
    expect(typeof res.body.commit).toBe('string')
  })
})
