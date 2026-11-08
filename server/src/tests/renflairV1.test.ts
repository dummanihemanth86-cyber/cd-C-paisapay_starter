import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env.js';
import { sendRenflairV1Otp } from '../integrations/sms/renflairV1.js';

const previous = {
  url: env.renflairV1ApiUrl,
  key: env.renflairApiKey,
  configured: env.renflairConfigured,
};

afterEach(() => {
  env.renflairV1ApiUrl = previous.url;
  env.renflairApiKey = previous.key;
  env.renflairConfigured = previous.configured;
});

function configure() {
  env.renflairV1ApiUrl = 'https://sms.renflair.in/V1.php';
  env.renflairApiKey = 'test-api-key';
  env.renflairConfigured = true;
}

describe('Renflair V1 OTP adapter', () => {
  it('sends the V1 API, PHONE and OTP query parameters and treats the JSON response only as request acceptance', async () => {
    configure();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ result: 'queued' }), { status: 200 }));

    const result = await sendRenflairV1Otp({ phoneNumber: '+919876543210', otp: '123456', requestId: 'challenge-1' }, fetchMock);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [input, init] = fetchMock.mock.calls[0]!;
    const sentUrl = new URL(String(input));
    expect(sentUrl.origin + sentUrl.pathname).toBe('https://sms.renflair.in/V1.php');
    expect(sentUrl.searchParams.get('API')).toBe('test-api-key');
    expect(sentUrl.searchParams.get('PHONE')).toBe('9876543210');
    expect(sentUrl.searchParams.get('OTP')).toBe('123456');
    expect(init?.method).toBe('GET');
    expect(result).toEqual({ status: 'PENDING', state: 'ACCEPTED', smsId: null, requestId: 'challenge-1' });
  });

  it('rejects explicit failure responses, non-object JSON and malformed JSON', async () => {
    configure();
    const rejected = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 0, msg: 'failed' }), { status: 200 }));
    await expect(sendRenflairV1Otp({ phoneNumber: '+919876543210', otp: '123456', requestId: 'challenge-2' }, rejected)).rejects.toMatchObject({ code: 'SMS_GATEWAY_REJECTED' });
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(new Response('not-json', { status: 200 }));
    await expect(sendRenflairV1Otp({ phoneNumber: '+919876543210', otp: '123456', requestId: 'challenge-3' }, malformed)).rejects.toMatchObject({ code: 'SMS_GATEWAY_BAD_RESPONSE' });
    const primitive = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify('not-an-object'), { status: 200 }));
    await expect(sendRenflairV1Otp({ phoneNumber: '+919876543210', otp: '123456', requestId: 'challenge-8' }, primitive)).rejects.toMatchObject({ code: 'SMS_GATEWAY_BAD_RESPONSE' });
  });

  it('fails closed for HTTP errors, timeouts, missing configuration, and unsupported numbers', async () => {
    configure();
    const httpError = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 503 }));
    await expect(sendRenflairV1Otp({ phoneNumber: '+919876543210', otp: '123456', requestId: 'challenge-4' }, httpError)).rejects.toMatchObject({ code: 'SMS_GATEWAY_REJECTED' });
    const stalledFetch = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    await expect(sendRenflairV1Otp({ phoneNumber: '+919876543210', otp: '123456', requestId: 'challenge-5' }, stalledFetch, 5)).rejects.toMatchObject({ code: 'SMS_GATEWAY_TIMEOUT' });
    await expect(sendRenflairV1Otp({ phoneNumber: '+14155552671', otp: '123456', requestId: 'challenge-6' }, stalledFetch)).rejects.toMatchObject({ code: 'SMS_GATEWAY_REJECTED' });
    env.renflairConfigured = false;
    await expect(sendRenflairV1Otp({ phoneNumber: '+919876543210', otp: '123456', requestId: 'challenge-7' }, stalledFetch)).rejects.toMatchObject({ code: 'SMS_GATEWAY_UNAVAILABLE' });
  });
});
