import { z } from 'zod';
import { env } from '../../config/env.js';

const gatewayStatus = z.enum(['PENDING', 'SENT', 'DELIVERED', 'FAILED', 'UNKNOWN']);
const sendResponseSchema = z.object({
  success: z.boolean(),
  status: gatewayStatus.optional(),
  sms_id: z.number().int().positive().optional(),
  request_id: z.string().optional(),
}).passthrough();
const statusResponseSchema = z.object({
  success: z.boolean(),
  status: gatewayStatus,
  sms_id: z.number().int().positive().optional(),
  request_id: z.string().optional(),
}).passthrough();

export type GatewayDeliveryStatus = z.infer<typeof gatewayStatus>;
export type OtpDeliveryState = 'ACCEPTED' | 'SENT' | 'DELIVERED' | 'FAILED' | 'UNKNOWN';

export class SmsGatewayError extends Error {
  constructor(public readonly code: 'SMS_GATEWAY_TIMEOUT' | 'SMS_GATEWAY_UNAVAILABLE' | 'SMS_GATEWAY_REJECTED' | 'SMS_GATEWAY_BAD_RESPONSE', message: string) {
    super(message);
    this.name = 'SmsGatewayError';
  }
}

function deliveryState(status: GatewayDeliveryStatus): OtpDeliveryState {
  return status === 'PENDING' ? 'ACCEPTED' : status;
}

async function gatewayRequest(path: string, init: RequestInit, fetchImpl: typeof fetch = fetch, timeoutMs = env.smsGatewayTimeoutMs) {
  if (!env.smsGatewayConfigured || !env.smsGatewayUrl || !env.smsGatewayApiKey) {
    throw new SmsGatewayError('SMS_GATEWAY_UNAVAILABLE', 'SMS delivery is not configured.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${env.smsGatewayUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { Accept: 'application/json', 'X-API-Key': env.smsGatewayApiKey, ...init.headers },
    });
    let data: unknown;
    try { data = await response.json(); } catch {
      throw new SmsGatewayError('SMS_GATEWAY_BAD_RESPONSE', 'SMS gateway returned an invalid response.');
    }
    return { response, data };
  } catch (error) {
    if (error instanceof SmsGatewayError) throw error;
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new SmsGatewayError('SMS_GATEWAY_TIMEOUT', 'SMS gateway request timed out.');
    }
    throw new SmsGatewayError('SMS_GATEWAY_UNAVAILABLE', 'SMS gateway is offline or unreachable.');
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendGatewaySms(input: { phoneNumber: string; message: string; requestId: string }, fetchImpl?: typeof fetch, timeoutMs?: number) {
  const { response, data } = await gatewayRequest('/api/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone_number: input.phoneNumber, message: input.message, request_id: input.requestId }),
  }, fetchImpl, timeoutMs);
  const parsed = sendResponseSchema.safeParse(data);
  if (!response.ok || !parsed.success || !parsed.data.success || !parsed.data.status || parsed.data.status === 'FAILED') {
    throw new SmsGatewayError('SMS_GATEWAY_REJECTED', 'SMS gateway did not accept the message.');
  }
  return {
    status: parsed.data.status,
    state: deliveryState(parsed.data.status),
    smsId: parsed.data.sms_id ?? null,
    requestId: parsed.data.request_id ?? input.requestId,
  };
}

export async function getGatewaySmsStatus(requestId: string, fetchImpl?: typeof fetch, timeoutMs?: number) {
  const query = new URLSearchParams({ request_id: requestId });
  const { response, data } = await gatewayRequest(`/api/status?${query}`, { method: 'GET' }, fetchImpl, timeoutMs);
  const parsed = statusResponseSchema.safeParse(data);
  if (!response.ok || !parsed.success || !parsed.data.success) {
    throw new SmsGatewayError('SMS_GATEWAY_REJECTED', 'SMS gateway could not provide the message status.');
  }
  return { status: parsed.data.status, state: deliveryState(parsed.data.status) };
}
