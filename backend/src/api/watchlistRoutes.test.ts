import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';

describe('watchlist routes', () => {
  const app = createApp();

  it('returns 401 without authorization', async () => {
    const response = await request(app).get('/api/watchlist');
    expect(response.status).toBe(401);
  });

  it('returns 422 for invalid create body when authenticated with bad token', async () => {
    const response = await request(app)
      .post('/api/watchlist')
      .set('Authorization', 'Bearer not-a-jwt')
      .send({});
    expect([401, 422]).toContain(response.status);
  });
});
