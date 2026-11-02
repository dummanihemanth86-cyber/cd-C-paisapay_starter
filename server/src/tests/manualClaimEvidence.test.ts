import { describe, expect, it } from 'vitest';
import { decodeManualClaimImage, validateUpiUtr } from '../modules/payments/manualClaimEvidence.js';

const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/SAAAAABJRU5ErkJggg==';

describe('manual UPI claim evidence validation', () => {
  it('accepts exactly 12 numeric UTR/RRN digits', () => {
    expect(validateUpiUtr('123456789012')).toBe(true);
    for (const value of ['12345678901', '1234567890123', '1234AB789012', '123456 89012', ' 123456789012']) expect(validateUpiUtr(value)).toBe(false);
  });

  it('accepts supported base64 image evidence only when signature matches its MIME type', () => {
    expect(decodeManualClaimImage(tinyPng, 'image/png').bytes.subarray(0, 4).toString('hex')).toBe('89504e47');
    expect(() => decodeManualClaimImage(tinyPng, 'image/jpeg')).toThrow(/does not match/);
    expect(() => decodeManualClaimImage('not-base64!', 'image/png')).toThrow(/malformed/);
    expect(() => decodeManualClaimImage(tinyPng, 'image/svg+xml')).toThrow(/JPEG, PNG, or WebP/);
  });
});
