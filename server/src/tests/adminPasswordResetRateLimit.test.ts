import { describe, expect, it } from 'vitest';
import { adminPasswordResetIpKey } from '../modules/admin/passwordResetRateLimit.js';

function request(ip: string, cloudflareIp?: string) {
  return { ip, get: (name: string) => name.toLowerCase() === 'cf-connecting-ip' ? cloudflareIp : undefined };
}

describe('Admin password-reset IP rate-limit key', () => {
  it('uses the edge-verified visitor IP on the explicitly identified staging service', () => {
    expect(adminPasswordResetIpKey(request('10.31.99.80', '198.51.100.24'), true))
      .toBe('admin-reset-ip:198.51.100.24');
  });

  it('ignores the forwarded header outside staging to prevent client spoofing', () => {
    expect(adminPasswordResetIpKey(request('10.31.99.80', '198.51.100.24'), false))
      .toBe('admin-reset-ip:10.31.99.80');
  });

  it('falls back to Express IP if the staging edge header is missing or malformed', () => {
    expect(adminPasswordResetIpKey(request('10.31.99.80', '198.51.100.24, 10.0.0.2'), true))
      .toBe('admin-reset-ip:10.31.99.80');
    expect(adminPasswordResetIpKey(request('10.31.99.80'), true))
      .toBe('admin-reset-ip:10.31.99.80');
  });

  it('groups IPv6 addresses by the library-safe subnet instead of allowing address rotation', () => {
    const first = adminPasswordResetIpKey(request('10.31.99.80', '2001:db8:abcd:1200::1'), true);
    const second = adminPasswordResetIpKey(request('10.31.99.80', '2001:db8:abcd:12ff::9'), true);
    expect(first).toBe('admin-reset-ip:2001:db8:abcd:1200::/56');
    expect(second).toBe(first);
  });
});
