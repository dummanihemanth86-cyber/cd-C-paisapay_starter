import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';

const CASHFREE_SANDBOX_BASE = 'https://sandbox.cashfree.com/pg';
const CASHFREE_TIMEOUT_MS = 10_000;

export type CashfreePayment = {
  cf_payment_id?: string | number;
  order_id?: string;
  payment_status?: string;
  payment_amount?: number | string;
  payment_currency?: string;
};

export type CashfreeOrder = {
  order_id?: string;
  order_amount?: number | string;
  order_currency?: string;
  order_status?: string;
};

export function cashfreeSandboxAvailable() {
  return env.paymentProvider === 'cashfree-sandbox' && env.cashfreeConfigured;
}

async function callCashfree(path: string, init: RequestInit = {}) {
  if (!cashfreeSandboxAvailable() || !env.cashfreeClientId || !env.cashfreeClientSecret) {
    throw new Error('CASHFREE_UNAVAILABLE');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CASHFREE_TIMEOUT_MS);
  try {
    const response = await fetch(`${CASHFREE_SANDBOX_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-api-version': env.cashfreeApiVersion,
        'x-client-id': env.cashfreeClientId,
        'x-client-secret': env.cashfreeClientSecret,
        ...init.headers,
      },
    });
    const raw = await response.text();
    let body: Record<string, unknown> = {};
    try { body = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { /* never echo provider text to clients */ }
    if (!response.ok) throw new Error(response.status >= 500 || response.status === 429 ? 'CASHFREE_TEMPORARY_FAILURE' : 'CASHFREE_REQUEST_REJECTED');
    return body;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('CASHFREE_')) throw error;
    throw new Error(error instanceof Error && error.name === 'AbortError' ? 'CASHFREE_TIMEOUT' : 'CASHFREE_NETWORK_FAILURE');
  } finally {
    clearTimeout(timeout);
  }
}

export async function createCashfreeOrder(input: {
  orderId: string;
  idempotencyKey: string;
  amountPaise: number;
  userId: string;
  phoneE164: string;
}) {
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise < 1000) throw new Error('CASHFREE_AMOUNT_INVALID');
  const body = await callCashfree('/orders', {
    method: 'POST',
    headers: { 'x-idempotency-key': input.idempotencyKey },
    body: JSON.stringify({
      order_id: input.orderId,
      order_amount: input.amountPaise / 100,
      order_currency: 'INR',
      customer_details: {
        customer_id: input.userId,
        customer_phone: input.phoneE164,
      },
      order_note: 'PaisaPay sandbox checkout',
    }),
  });
  if (body.order_id !== input.orderId || typeof body.payment_session_id !== 'string' || !body.payment_session_id) {
    throw new Error('CASHFREE_BAD_RESPONSE');
  }
  return { orderId: input.orderId, paymentSessionId: body.payment_session_id };
}

export async function getCashfreeOrder(orderId: string) {
  const body = await callCashfree(`/orders/${encodeURIComponent(orderId)}`, { method: 'GET' });
  return body as CashfreeOrder;
}

export async function getCashfreePayments(orderId: string) {
  const body = await callCashfree(`/orders/${encodeURIComponent(orderId)}/payments`, { method: 'GET' });
  return Array.isArray(body) ? body as CashfreePayment[] : [];
}

export function verifyCashfreeWebhook(rawBody: Buffer, signature: string | undefined, timestamp: string | undefined) {
  if (!env.cashfreeClientSecret || !rawBody.length || !signature || !timestamp || !/^\d{10,20}$/.test(timestamp)) return false;
  const expected = createHmac('sha256', env.cashfreeClientSecret).update(timestamp).update(rawBody).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, 'base64'); } catch { return false; }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature) || actual.toString('base64') !== signature) return false;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
