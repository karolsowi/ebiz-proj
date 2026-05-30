import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';

describe('auth routes', () => {
  const app = createApp();

  it('returns 422 when register payload is invalid', async () => {
    const response = await request(app).post('/api/auth/register').send({
      email: 'not-an-email',
      password: 'short',
      firstName: '',
      lastName: 'User',
    });
    expect(response.status).toBe(422);
    expect(response.body.error).toBe('Validation failed');
    expect(response.body.details).toBeDefined();
  });

  it('returns 422 when login payload is invalid', async () => {
    const response = await request(app).post('/api/auth/login').send({
      email: 'bad',
      password: '',
    });
    expect(response.status).toBe(422);
  });

  it('returns 401 for wrong credentials shape after validation', async () => {
    const response = await request(app).post('/api/auth/login').send({
      email: 'nobody@example.com',
      password: 'WrongPass1',
    });
    expect(response.status).toBe(401);
  });
});
