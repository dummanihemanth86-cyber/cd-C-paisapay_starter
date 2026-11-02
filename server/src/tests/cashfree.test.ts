import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env.js';
import { cashfreeSandboxAvailable, createCashfreeOrder, getCashfreeOrder, getCashfreePayments, verifyCashfreeWebhook } from '../integrations/payments/cashfree.js';

describe('Cashfree sandbox adapter', () => {
  const old = { provider: env.paymentProvider, id: env.cashfreeClientId, secret: env.cashfreeClientSecret, configured: env.cashfreeConfigured };
  afterEach(() => {
    vi.unstubAllGlobals();
    env.paymentProvider = old.provider;
    env.cashfreeClientId = old.id;
    env.cashfreeClientSecret = old.secret;
    env.cashfreeConfigured = old.configured;
  });

  it('fails closed unless sandbox mode and credentials are configured', () => {
    env.paymentProvider = 'disabled';
    env.cashfreeConfigured = false;
    expect(cashfreeSandboxAvailable()).toBe(false);
  });

  it('creates only INR orders and returns the documented session ID', async () => {
    env.paymentProvider = 'cashfree-sandbox';
    env.cashfreeConfigured = true;
    env.cashfreeClientId = 'sandbox-client';
    env.cashfreeClientSecret = 'sandbox-secret';
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://sandbox.cashfree.com/pg/orders');
      expect((init.headers as Record<string, string>)['x-client-id']).toBe('sandbox-client');
      expect((init.headers as Record<string, string>)['x-idempotency-key']).toBe('11111111-1111-4111-8111-111111111111');
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ order_id: 'PPDEP-TEST', order_amount: 100, order_currency: 'INR' });
      return new Response(JSON.stringify({ order_id: body.order_id, payment_session_id: 'session-sandbox-only' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await createCashfreeOrder({ orderId: 'PPDEP-TEST', idempotencyKey: '11111111-1111-4111-8111-111111111111', amountPaise: 10000, userId: 'user-1', phoneE164: '+919999999999' });
    expect(result).toEqual({ orderId: 'PPDEP-TEST', paymentSessionId: 'session-sandbox-only' });
  });

  it('fetches server-side order and payment status without leaking provider errors', async () => {
    env.paymentProvider = 'cashfree-sandbox'; env.cashfreeConfigured = true; env.cashfreeClientId = 'id'; env.cashfreeClientSecret = 'secret';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ order_id: 'PPDEP-A', order_status: 'PAID' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ cf_payment_id: 'cf-1', order_id: 'PPDEP-A', payment_status: 'SUCCESS', payment_amount: 12, payment_currency: 'INR' }]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getCashfreeOrder('PPDEP-A')).resolves.toMatchObject({ order_status: 'PAID' });
    await expect(getCashfreePayments('PPDEP-A')).resolves.toMatchObject([{ cf_payment_id: 'cf-1', payment_status: 'SUCCESS' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('authenticates webhook signatures over timestamp and exact raw bytes', () => {
    env.cashfreeClientSecret = 'sandbox-secret';
    const timestamp = '1792240000000';
    const raw = Buffer.from('{"type":"PAYMENT_SUCCESS_WEBHOOK"}');
    const signature = createHmac('sha256', 'sandbox-secret').update(timestamp).update(raw).digest('base64');
    expect(verifyCashfreeWebhook(raw, signature, timestamp)).toBe(true);
    expect(verifyCashfreeWebhook(raw, signature, '1792240000001')).toBe(false);
    expect(verifyCashfreeWebhook(raw, `${signature}x`, timestamp)).toBe(false);
  });
});
