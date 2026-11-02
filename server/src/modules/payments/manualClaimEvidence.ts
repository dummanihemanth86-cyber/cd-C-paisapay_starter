import { HttpError } from '../../lib/http.js';

export const MAX_MANUAL_CLAIM_IMAGE_BYTES = 1_500_000;
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function decodeManualClaimImage(base64: unknown, mimeType: unknown): { bytes: Buffer; mimeType: string } {
  if (typeof mimeType !== 'string' || !allowedImageTypes.has(mimeType)) {
    throw new HttpError(400, 'INVALID_PAYMENT_IMAGE', 'Attach a JPEG, PNG, or WebP transaction screenshot.');
  }
  if (typeof base64 !== 'string' || base64.length === 0 || base64.length > Math.ceil(MAX_MANUAL_CLAIM_IMAGE_BYTES * 4 / 3) + 8 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new HttpError(400, 'INVALID_PAYMENT_IMAGE', 'The transaction screenshot is missing, malformed, or too large (maximum 1.5 MB).');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_MANUAL_CLAIM_IMAGE_BYTES || bytes.toString('base64') !== base64) {
    throw new HttpError(400, 'INVALID_PAYMENT_IMAGE', 'The transaction screenshot is malformed or too large (maximum 1.5 MB).');
  }
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!(mimeType === 'image/jpeg' && isJpeg) && !(mimeType === 'image/png' && isPng) && !(mimeType === 'image/webp' && isWebp)) {
    throw new HttpError(400, 'INVALID_PAYMENT_IMAGE', 'The screenshot file does not match its declared image type.');
  }
  return { bytes, mimeType };
}

export function validateUpiUtr(value: unknown): value is string {
  return typeof value === 'string' && /^\d{12}$/.test(value);
}
