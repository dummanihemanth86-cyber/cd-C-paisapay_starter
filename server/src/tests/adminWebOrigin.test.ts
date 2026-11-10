import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { isAllowedApiOrigin, STAGING_ADMIN_WEB_ORIGIN, STAGING_SWAGGER_API_ORIGIN } from '../config/adminWebOrigin.js';
import { app } from '../app.js';

const base = { apiProductionOrigin: 'https://paisapay-api.onrender.com', appOrigins: [], isDevelopment: false, isExplicitRenderStaging: false };

describe('Admin web origin policy', () => {
  it('allows the GitHub Pages Admin frontend only on explicitly identified staging', () => {
    expect(isAllowedApiOrigin(STAGING_ADMIN_WEB_ORIGIN, { ...base, isExplicitRenderStaging: true })).toBe(true);
    expect(isAllowedApiOrigin(STAGING_ADMIN_WEB_ORIGIN, base)).toBe(false);
  });
  it('allows the staging Swagger origin only for the explicit Render staging service', () => {
    expect(isAllowedApiOrigin(STAGING_SWAGGER_API_ORIGIN, { ...base, isExplicitRenderStaging: true })).toBe(true);
    expect(isAllowedApiOrigin(STAGING_SWAGGER_API_ORIGIN, base)).toBe(false);
    expect(isAllowedApiOrigin(STAGING_SWAGGER_API_ORIGIN, { ...base, appOrigins: [STAGING_SWAGGER_API_ORIGIN] })).toBe(false);
  });
  it('preserves the configured origins and development loopback behavior', () => {
    expect(isAllowedApiOrigin(base.apiProductionOrigin, base)).toBe(true);
    expect(isAllowedApiOrigin('https://admin.example.test', { ...base, appOrigins: ['https://admin.example.test'] })).toBe(true);
    expect(isAllowedApiOrigin('http://localhost:19006', { ...base, isDevelopment: true })).toBe(true);
    expect(isAllowedApiOrigin('https://untrusted.example', base)).toBe(false);
  });
  it('does not allow the staging UI origin in production', () => {
    expect(isAllowedApiOrigin(STAGING_ADMIN_WEB_ORIGIN, { ...base, appOrigins: [], isExplicitRenderStaging: false })).toBe(false);
  });
});

describe('public Admin app version endpoint', () => {
  it('returns only non-secret API build metadata without requiring an Admin session', async () => {
    const response = await request(app).get('/api/v1/admin/app-version').expect(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.body).toMatchObject({ service: 'paisapay-api', apiVersion: '1.0.0', deploymentEnvironment: 'test' });
    expect(response.body.buildId).toMatch(/^(unknown|[a-f0-9]{7,40})$/i);
    expect(Object.keys(response.body).sort()).toEqual(['apiVersion', 'buildId', 'deploymentEnvironment', 'service']);
    const spec = (await request(app).get('/api/v1/openapi.json').expect(200)).body;
    expect(spec.paths['/admin/app-version']?.get?.security).toEqual([]);
  });
});
