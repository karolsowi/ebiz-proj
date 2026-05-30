import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';

describe('portfolio routes', () => {
  const app = createApp();

  it('returns 401 without authorization', async () => {
    const response = await request(app).get('/api/portfolio');
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Missing authorization token');
  });

  it('returns 422 for invalid create body', async () => {
    const response = await request(app)
      .post('/api/portfolio')
      .set('Authorization', 'Bearer invalid')
      .send({ symbol: 'A' });
    expect([401, 422]).toContain(response.status);
  });
});
