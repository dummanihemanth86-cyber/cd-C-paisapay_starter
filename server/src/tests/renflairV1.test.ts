import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { sendRenflairV1Otp } from '../integrations/sms/renflairV1.js';

const previous = {
  url: env.renflairV1ApiUrl,
  key: env.renflairApiKey,
  configured: env.renflairConfigured,
};

afterEach(() => {
  vi.restoreAllMocks();
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
    expect(init?.headers).toEqual({ Accept: 'application/json' });
    expect(init?.body).toBeUndefined();
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
    for (const body of [{ status: 'FAILED' }, { status: 'error' }, { status: '503' }, { status: 503 }, { status_code: 503 }, { success: 'false' }, { result: 'rejected' }]) {
      const textualFailure = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
      await expect(sendRenflairV1Otp({ phoneNumber: '+919876543210', otp: '123456', requestId: 'challenge-9' }, textualFailure)).rejects.toMatchObject({ code: 'SMS_GATEWAY_REJECTED' });
    }
    const unknownStatus = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'queued-but-unrecognized' }), { status: 200 }));
    await expect(sendRenflairV1Otp({ phoneNumber: '+919876543210', otp: '123456', requestId: 'challenge-10' }, unknownStatus)).rejects.toMatchObject({ code: 'SMS_GATEWAY_BAD_RESPONSE' });
    const undocumentedShape = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ message: 'request accepted' }), { status: 200 }));
    await expect(sendRenflairV1Otp({ phoneNumber: '+919876543210', otp: '123456', requestId: 'challenge-11' }, undocumentedShape)).rejects.toMatchObject({ code: 'SMS_GATEWAY_BAD_RESPONSE' });
    const explicitSuccess = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ success: true, detail: 'provider-message-id-not-logged' }), { status: 200 }));
    await expect(sendRenflairV1Otp({ phoneNumber: '+919876543210', otp: '123456', requestId: 'challenge-13' }, explicitSuccess)).resolves.toMatchObject({ state: 'ACCEPTED' });
    const providerClaimedDelivery = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'delivered' }), { status: 200 }));
    await expect(sendRenflairV1Otp({ phoneNumber: '+919876543210', otp: '123456', requestId: 'challenge-14' }, providerClaimedDelivery)).rejects.toMatchObject({ code: 'SMS_GATEWAY_BAD_RESPONSE' });
  });

  it('URL-encodes V1 query values without logging them', async () => {
    configure();
    env.renflairApiKey = 'synthetic+key&value/with spaces';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    await sendRenflairV1Otp({ phoneNumber: '+919876543210', otp: '123456', requestId: 'challenge-encoded' }, fetchMock);
    const sentUrl = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(sentUrl.searchParams.get('API')).toBe('synthetic+key&value/with spaces');
    expect(sentUrl.searchParams.get('PHONE')).toBe('9876543210');
    expect(sentUrl.searchParams.get('OTP')).toBe('123456');
  });

  it('logs sanitized provider diagnostics without the URL, API key, phone or OTP', async () => {
    configure();
    const warning = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'FAILED', error: 'insufficient balance for 9876543210' }), { status: 200 }));
    await expect(sendRenflairV1Otp({ phoneNumber: '+919876543210', otp: '123456', requestId: 'safe-request-123' }, fetchMock)).rejects.toMatchObject({
      code: 'SMS_GATEWAY_REJECTED',
      message: 'Renflair reports insufficient SMS balance. Contact the SMS provider or account owner.',
    });
    const badCredentials = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: 'Invalid API key secret-string' }), { status: 200 }));
    await expect(sendRenflairV1Otp({ phoneNumber: '+919876543210', otp: '123456', requestId: 'safe-request-124' }, badCredentials)).rejects.toMatchObject({
      code: 'SMS_GATEWAY_REJECTED',
      message: 'Renflair rejected its credentials. Check the staging Renflair API key in the server environment.',
    });

    const diagnosticLog = JSON.stringify(warning.mock.calls);
    expect(diagnosticLog).toContain('safe-request-123');
    expect(diagnosticLog).toContain('httpStatus');
    expect(diagnosticLog).toContain('200');
    expect(diagnosticLog).toContain('rejected');
    expect(diagnosticLog).toContain('balance');
    for (const secret of ['test-api-key', '+919876543210', '9876543210', '123456', 'sms.renflair.in']) {
      expect(diagnosticLog).not.toContain(secret);
    }
  });

  it('logs request correlation, challenge and timing without provider secrets', async () => {
    configure();
    const info = vi.spyOn(logger, 'info').mockImplementation(() => logger);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ result: 'queued' }), { status: 200 }));
    await sendRenflairV1Otp({
      phoneNumber: '+919876543210', otp: '123456', requestId: 'challenge-7',
      correlationId: 'http-request-7', purpose: 'ADMIN_PASSWORD_RESET', environment: 'staging',
    }, fetchMock);

    const logs = JSON.stringify(info.mock.calls);
    for (const safeValue of ['http-request-7', 'challenge-7', 'ADMIN_PASSWORD_RESET', 'staging', 'httpMethod', 'endpointPath', 'durationMs', 'unsupported_by_documented_v1_api', 'configuration', 'available']) {
      expect(logs).toContain(safeValue);
    }
    for (const secret of ['test-api-key', '+919876543210', '9876543210', '123456', 'sms.renflair.in', 'API=']) {
      expect(logs).not.toContain(secret);
    }
  });

  it('fails closed for HTTP errors, timeouts, missing configuration, and unsupported numbers', async () => {
    configure();
    const httpError = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 503 }));
    await expect(sendRenflairV1Otp({ phoneNumber: '+919876543210', otp: '123456', requestId: 'challenge-4' }, httpError)).rejects.toMatchObject({ code: 'SMS_GATEWAY_REJECTED' });
    const nonJsonHttpError = vi.fn<typeof fetch>().mockResolvedValue(new Response('upstream unavailable', { status: 401 }));
    await expect(sendRenflairV1Otp({ phoneNumber: '+919876543210', otp: '123456', requestId: 'challenge-12' }, nonJsonHttpError)).rejects.toMatchObject({
      code: 'SMS_GATEWAY_REJECTED',
      message: 'Renflair rejected the OTP request (HTTP 401). Check the provider account and try again.',
    });
    const stalledFetch = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    await expect(sendRenflairV1Otp({ phoneNumber: '+919876543210', otp: '123456', requestId: 'challenge-5' }, stalledFetch, 5)).rejects.toMatchObject({ code: 'SMS_GATEWAY_TIMEOUT' });
    await expect(sendRenflairV1Otp({ phoneNumber: '+14155552671', otp: '123456', requestId: 'challenge-6' }, stalledFetch)).rejects.toMatchObject({ code: 'SMS_GATEWAY_REJECTED' });
    env.renflairConfigured = false;
    await expect(sendRenflairV1Otp({ phoneNumber: '+919876543210', otp: '123456', requestId: 'challenge-7' }, stalledFetch)).rejects.toMatchObject({ code: 'SMS_GATEWAY_UNAVAILABLE' });
  });
});
