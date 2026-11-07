import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../app.js';

describe('Admin password-reset API contract', () => {
  it('documents both reset endpoints with request bodies and public access', async () => {
    const spec = (await request(app).get('/api/v1/openapi.json').expect(200)).body;
    for (const path of ['/admin/auth/forgot-password/request-otp', '/admin/auth/password/reset']) {
      const operation = spec.paths[path]?.post;
      expect(operation?.requestBody?.required).toBe(true);
      expect(operation?.requestBody?.content?.['application/json']?.schema?.required).toBeDefined();
      expect(operation?.security).toBeUndefined();
    }
    expect(spec.paths['/admin/auth/forgot-password/request-otp'].post.requestBody.content['application/json'].schema.required).toEqual(['phoneE164']);
    expect(spec.paths['/admin/auth/password/reset'].post.requestBody.content['application/json'].schema.required).toEqual(['phoneE164', 'challengeId', 'code', 'newPassword']);
  });

  it('validates reset input before reaching the database or sending an OTP', async () => {
    const result = await request(app).post('/api/v1/admin/auth/forgot-password/request-otp').send({}).expect(400);
    expect(result.body.error.code).toBe('VALIDATION_ERROR');
  });
});
