import { env } from '../../config/env.js';
import { SmsGatewayError, type OtpDeliveryState } from './androidGateway.js';

/**
 * Renflair V1 accepts API, PHONE and OTP as query parameters. The supplied V1
 * example only JSON-decodes the response; it does not define a response
 * schema or a delivery-status API. We therefore report only that the HTTP
 * endpoint returned a valid JSON response, never handset delivery.
 */
export async function sendRenflairV1Otp(
  input: { phoneNumber: string; otp: string; requestId: string },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = env.smsGatewayTimeoutMs,
) {
  if (!env.renflairConfigured || !env.renflairApiKey) {
    throw new SmsGatewayError('SMS_GATEWAY_UNAVAILABLE', 'Renflair V1 OTP is not configured.');
  }
  if (!/^\+91\d{10}$/.test(input.phoneNumber) || !/^\d{6}$/.test(input.otp)) {
    throw new SmsGatewayError('SMS_GATEWAY_REJECTED', 'Renflair V1 requires an Indian mobile number and a six-digit OTP.');
  }

  const url = new URL(env.renflairV1ApiUrl);
  url.searchParams.set('API', env.renflairApiKey);
  url.searchParams.set('PHONE', input.phoneNumber.slice(3));
  url.searchParams.set('OTP', input.otp);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    let body: unknown;
    try { body = await response.json(); } catch {
      throw new SmsGatewayError('SMS_GATEWAY_BAD_RESPONSE', 'Renflair V1 returned a response that PaisaPay could not parse.');
    }

    // V1 documents JSON decoding but no response schema. Require a JSON object
    // and reject explicit failures without inventing undocumented success keys.
    const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : undefined;
    if (!record) throw new SmsGatewayError('SMS_GATEWAY_BAD_RESPONSE', 'Renflair V1 returned an unsupported JSON response.');
    const explicitlyFailed = record && (
      record.success === false || record.status === 0 || record.status === false ||
      typeof record.error === 'string' && record.error.length > 0
    );
    if (!response.ok || explicitlyFailed) {
      throw new SmsGatewayError('SMS_GATEWAY_REJECTED', 'Renflair V1 did not accept the OTP request.');
    }

    return {
      status: 'PENDING' as const,
      state: 'ACCEPTED' as OtpDeliveryState,
      smsId: null,
      requestId: input.requestId,
    };
  } catch (error) {
    if (error instanceof SmsGatewayError) throw error;
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new SmsGatewayError('SMS_GATEWAY_TIMEOUT', 'Renflair V1 request timed out; delivery status is unknown.');
    }
    throw new SmsGatewayError('SMS_GATEWAY_UNAVAILABLE', 'Renflair V1 is offline or unreachable.');
  } finally {
    clearTimeout(timeout);
  }
}
