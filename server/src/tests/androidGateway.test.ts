import { describe, expect, it, vi } from 'vitest';
import { getGatewaySmsStatus, sendGatewaySms } from '../integrations/sms/androidGateway.js';
import { env } from '../config/env.js';

const input = { phoneNumber: '+919876543210', message: 'Verification code 123456', requestId: 'challenge-123' };

describe('Android SMS gateway adapter', () => {
  it('uses the documented endpoint, private header, request fields, and distinguishes queued from delivered', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ success: true, message: 'SMS queued for sending', sms_id: 72, request_id: input.requestId, status: 'PENDING' }), { status: 200 }));
    const result = await sendGatewaySms(input, fetchMock);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${env.smsGatewayUrl}/api/send`);
    expect(new Headers(init?.headers).get('X-API-Key')).toBe(env.smsGatewayApiKey);
    expect(JSON.parse(String(init?.body))).toEqual({ phone_number: input.phoneNumber, message: input.message, request_id: input.requestId });
    expect(result).toEqual({ status: 'PENDING', state: 'ACCEPTED', smsId: 72, requestId: input.requestId });
  });

  it('maps a real status response to SENT or DELIVERED without returning gateway message contents', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ success: true, status: 'DELIVERED', phone_number: input.phoneNumber, message: input.message, request_id: input.requestId }), { status: 200 }));
    const result = await getGatewaySmsStatus(input.requestId, fetchMock);
    expect(result).toEqual({ status: 'DELIVERED', state: 'DELIVERED' });
    expect(JSON.stringify(result)).not.toContain(input.message);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${env.smsGatewayUrl}/api/status?request_id=${input.requestId}`);
  });

  it('times out a stalled gateway request', async () => {
    const stalledFetch = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    await expect(sendGatewaySms(input, stalledFetch, 5)).rejects.toMatchObject({ code: 'SMS_GATEWAY_TIMEOUT' });
  });

  it('rejects an unsuccessful or malformed gateway response', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ success: false, error: 'SMS_SEND_FAILED' }), { status: 400 }));
    await expect(sendGatewaySms(input, fetchMock)).rejects.toMatchObject({ code: 'SMS_GATEWAY_REJECTED' });
  });
});
