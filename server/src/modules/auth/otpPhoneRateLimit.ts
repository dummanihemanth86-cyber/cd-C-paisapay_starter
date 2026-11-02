export function isOtpPhoneLimitExempt(phoneE164: string, exemptPhone: string | undefined): boolean {
  return exemptPhone !== undefined && phoneE164 === exemptPhone;
}
