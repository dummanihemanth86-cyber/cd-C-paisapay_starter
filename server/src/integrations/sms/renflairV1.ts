import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { SmsGatewayError, type OtpDeliveryState } from './androidGateway.js';

type RenflairResponseDiagnostics = {
  providerResponseStatus: 'not_provided' | 'accepted' | 'pending' | 'sent' | 'rejected' | 'numeric' | 'unrecognized' | 'non_scalar';
  providerErrorCategory: 'none' | 'balance' | 'template_or_sender' | 'route_or_network' | 'credentials' | 'provider_rejection' | 'present_unclassified' | 'present_unstructured';
};

const failureTokens = new Set(['0', 'false', 'error', 'failed', 'failure', 'rejected', 'denied']);
const successTokens = new Set(['1', 'true', 'ok', 'success', 'accepted', 'queued']);
const pendingTokens = new Set(['pending', 'processing', 'submitted']);
const sentTokens = new Set(['sent', 'delivered']);

function isExplicitFailure(value: unknown): boolean {
  if (value === false || value === 0) return true;
  if (typeof value === 'number') return value >= 400 && value <= 599;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return failureTokens.has(normalized) || /^[45]\d{2}$/.test(normalized) || /\b(error|failed|failure|rejected|denied)\b/i.test(value);
}

function categorizeProviderError(value: unknown): RenflairResponseDiagnostics['providerErrorCategory'] {
  if (value === undefined || value === null || value === false || value === '') return 'none';
  if (typeof value !== 'string') return 'present_unstructured';
  const error = value.toLowerCase();
  return /balance|credit|recharge|funds?/.test(error) ? 'balance'
    : /template|sender|header|dlt/.test(error) ? 'template_or_sender'
      : /route|operator|network/.test(error) ? 'route_or_network'
        : /api.?key|credential|unauthori[sz]ed|authentication|invalid api|wrong api/.test(error) ? 'credentials'
          : /reject|fail|error|invalid|denied/.test(error) ? 'provider_rejection'
            : 'present_unclassified';
}

function rejectionMessage(category: RenflairResponseDiagnostics['providerErrorCategory'], httpStatus: number | null): string {
  if (category === 'credentials') return 'Renflair rejected its credentials. Check the staging Renflair API key in the server environment.';
  if (category === 'balance') return 'Renflair reports insufficient SMS balance. Contact the SMS provider or account owner.';
  if (category === 'template_or_sender') return 'Renflair rejected the SMS sender or message configuration. Contact the SMS provider.';
  if (category === 'route_or_network') return 'Renflair rejected the SMS route or phone destination. Verify the Admin mobile number and contact the SMS provider.';
  if (httpStatus !== null && ![200, 201, 202, 204].includes(httpStatus)) {
    return `Renflair rejected the OTP request (HTTP ${httpStatus}). Check the provider account and try again.`;
  }
  return 'Renflair rejected the OTP request. Check the provider dashboard or contact the service administrator.';
}

function categorizeProviderResponse(record: Record<string, unknown>): RenflairResponseDiagnostics {
  const statusValue = record.status ?? record.status_code ?? record.statusCode ?? record.result ?? record.success;
  let providerResponseStatus: RenflairResponseDiagnostics['providerResponseStatus'] = 'not_provided';
  if (typeof statusValue === 'boolean') providerResponseStatus = statusValue ? 'accepted' : 'rejected';
  else if (typeof statusValue === 'number') providerResponseStatus = statusValue === 0 || (statusValue >= 400 && statusValue <= 599) ? 'rejected' : 'numeric';
  else if (typeof statusValue === 'string') {
    const status = statusValue.trim().toLowerCase();
    providerResponseStatus = failureTokens.has(status) || /^[45]\d{2}$/.test(status) ? 'rejected'
      : successTokens.has(status) ? 'accepted'
        : pendingTokens.has(status) ? 'pending'
          : sentTokens.has(status) ? 'sent'
            : 'unrecognized';
  } else if (statusValue !== undefined && statusValue !== null) providerResponseStatus = 'non_scalar';

  const explicitError = record.error ?? record.error_message ?? record.errorMessage;
  const messageError = record.msg ?? record.message;
  const messageLooksLikeError = typeof messageError === 'string'
    && (/balance|credit|recharge|funds?|template|sender|header|dlt|route|operator|network|api.?key|credential|unauthori[sz]ed|authentication|reject|fail|error|invalid|denied/i.test(messageError));
  const providerErrorCategory = explicitError !== undefined
    ? categorizeProviderError(explicitError)
    : messageLooksLikeError ? categorizeProviderError(messageError) : 'none';

  return { providerResponseStatus, providerErrorCategory };
}

/**
 * Renflair V1 accepts API, PHONE and OTP as query parameters. The supplied V1
 * example only JSON-decodes the response; it does not define a response
 * schema or a delivery-status API. We therefore report only that the HTTP
 * endpoint returned a valid JSON response without an explicit rejection,
 * never handset delivery. The provider does not document a response schema.
 */
export async function sendRenflairV1Otp(
  input: { phoneNumber: string; otp: string; requestId: string; correlationId?: string; purpose?: string; environment?: string },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = env.smsGatewayTimeoutMs,
) {
  const startedAt = performance.now();
  const diagnosticsContext = {
    requestId: input.correlationId ?? input.requestId,
    challengeId: input.requestId,
    environment: input.environment ?? (env.isExplicitRenderStaging ? 'staging' : env.isProduction ? 'production' : env.isDevelopment ? 'development' : 'test'),
    purpose: input.purpose ?? 'unspecified',
    provider: 'renflair-v1',
  };
  if (!env.renflairConfigured || !env.renflairApiKey) {
    logger.warn({ ...diagnosticsContext, providerAttempted: false, configuration: 'missing_api_key' }, 'Renflair OTP was not attempted because the provider is not configured');
    throw new SmsGatewayError('SMS_GATEWAY_UNAVAILABLE', 'Renflair V1 OTP is not configured.');
  }
  if (!/^\+91\d{10}$/.test(input.phoneNumber) || !/^\d{6}$/.test(input.otp)) {
    logger.warn({ ...diagnosticsContext, providerAttempted: false, validation: 'invalid_phone_or_otp_format' }, 'Renflair OTP was not attempted because request validation failed');
    throw new SmsGatewayError('SMS_GATEWAY_REJECTED', 'Renflair V1 requires an Indian mobile number and a six-digit OTP.');
  }

  const url = new URL(env.renflairV1ApiUrl);
  url.searchParams.set('API', env.renflairApiKey);
  url.searchParams.set('PHONE', input.phoneNumber.slice(3));
  url.searchParams.set('OTP', input.otp);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let httpStatus: number | null = null;
  let diagnostics: RenflairResponseDiagnostics = { providerResponseStatus: 'not_provided', providerErrorCategory: 'none' };
  try {
    logger.info({ ...diagnosticsContext, providerAttempted: true, httpMethod: 'GET', endpointPath: new URL(env.renflairV1ApiUrl).pathname, timeoutMs }, 'Renflair OTP provider request started');
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    httpStatus = response.status;
    let body: unknown;
    try { body = await response.json(); } catch {
      diagnostics = { providerResponseStatus: 'unrecognized', providerErrorCategory: 'present_unclassified' };
      logger.warn({ ...diagnosticsContext, httpStatus, durationMs: Math.round(performance.now() - startedAt), ...diagnostics }, 'Renflair OTP response was not valid JSON');
      if (!response.ok) {
        throw new SmsGatewayError('SMS_GATEWAY_REJECTED', rejectionMessage(diagnostics.providerErrorCategory, httpStatus));
      }
      throw new SmsGatewayError('SMS_GATEWAY_BAD_RESPONSE', 'Renflair V1 returned a response that PaisaPay could not parse.');
    }

    // V1 documents JSON decoding but no response schema. Require a JSON object
    // and reject explicit failures without inventing undocumented success keys.
    const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : undefined;
    if (!record) {
      diagnostics = { providerResponseStatus: 'non_scalar', providerErrorCategory: 'present_unstructured' };
      logger.warn({ ...diagnosticsContext, httpStatus, durationMs: Math.round(performance.now() - startedAt), ...diagnostics }, 'Renflair OTP response had an unsupported JSON shape');
      throw new SmsGatewayError('SMS_GATEWAY_BAD_RESPONSE', 'Renflair V1 returned an unsupported JSON response.');
    }
    diagnostics = categorizeProviderResponse(record);
    const hasProviderError = diagnostics.providerErrorCategory !== 'none';
    const explicitlyFailed = isExplicitFailure(record.success) || isExplicitFailure(record.status)
      || isExplicitFailure(record.status_code) || isExplicitFailure(record.statusCode)
      || isExplicitFailure(record.result) || hasProviderError;
    const providerExplicitlyAccepted = ['accepted', 'pending', 'sent'].includes(diagnostics.providerResponseStatus);
    if (!response.ok || explicitlyFailed) {
      logger.warn({ ...diagnosticsContext, httpStatus, durationMs: Math.round(performance.now() - startedAt), ...diagnostics }, 'Renflair did not accept the OTP request');
      throw new SmsGatewayError('SMS_GATEWAY_REJECTED', rejectionMessage(diagnostics.providerErrorCategory, httpStatus));
    }

    logger.info({ ...diagnosticsContext, httpStatus, durationMs: Math.round(performance.now() - startedAt), ...diagnostics, providerStatusRecognized: providerExplicitlyAccepted, providerRequestReferenceAvailable: false, deliveryReceipt: 'unsupported_by_documented_v1_api', handsetDeliveryVerified: false }, 'Renflair returned a successful HTTP response without an explicit rejection; handset delivery is unconfirmed');

    return {
      status: 'PENDING' as const,
      state: 'ACCEPTED' as OtpDeliveryState,
      smsId: null,
      requestId: input.requestId,
    };
  } catch (error) {
    if (error instanceof SmsGatewayError) throw error;
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      logger.warn({ ...diagnosticsContext, httpStatus, durationMs: Math.round(performance.now() - startedAt), timeoutMs, providerResponseStatus: 'not_provided', providerErrorCategory: 'present_unclassified', providerRequestReferenceAvailable: false }, 'Renflair OTP request timed out');
      throw new SmsGatewayError('SMS_GATEWAY_TIMEOUT', 'Renflair V1 request timed out; delivery status is unknown.');
    }
    logger.warn({ ...diagnosticsContext, httpStatus, durationMs: Math.round(performance.now() - startedAt), ...diagnostics, providerErrorCategory: 'present_unclassified', providerRequestReferenceAvailable: false }, 'Renflair OTP transport failed');
    throw new SmsGatewayError('SMS_GATEWAY_UNAVAILABLE', 'Renflair V1 is offline or unreachable.');
  } finally {
    clearTimeout(timeout);
  }
}
