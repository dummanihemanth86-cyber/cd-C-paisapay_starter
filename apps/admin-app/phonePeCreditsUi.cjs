'use strict';

function phonePeCreditIntentUrl({ requestId, id, receiverVpa, payeeVpa, amountPaise }) {
  const recipient = receiverVpa ?? payeeVpa;
  if (!/^[A-Za-z0-9._-]{2,50}@[A-Za-z0-9.-]{2,50}$/.test(String(recipient || ''))) throw new Error('The server has not supplied a valid receiver UPI ID.');
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 10000 || amountPaise > 1000000 || amountPaise % 100 !== 0) throw new Error('The payment amount must be whole rupees from ₹100 to ₹10,000.');
  const reference = String(requestId ?? id ?? '').replace(/-/g, '');
  if (!/^[A-Za-z0-9]{16,40}$/.test(reference)) throw new Error('The payment request reference is invalid.');
  const params = new URLSearchParams({ pa: recipient, tr: reference, am: (amountPaise / 100).toFixed(2), cu: 'INR', tn: `PaisaPay credit ${reference.slice(0, 12)}` });
  return `upi://pay?${params.toString()}`;
}

function validatePhonePeApproval({ request, reference, amountRupees, payeeVpa, receiverConfirmed, reason }) {
  const expectedRupees = Number(request?.amountPaise) / 100;
  const amount = Number(String(amountRupees || '').trim());
  if (!/^[A-Za-z0-9._/-]{8,120}$/.test(String(reference || '').trim())) return 'Enter the exact PhonePe/UPI transaction reference.';
  if (!Number.isSafeInteger(amount) || amount !== expectedRupees) return `Enter the exact received amount, ₹${expectedRupees}.`;
  if (String(payeeVpa || '').trim().toLowerCase() !== String(request?.payeeVpa || '').trim().toLowerCase()) return `Confirm that payment was received by ${request?.payeeVpa || 'the configured receiver'}.`;
  if (!receiverConfirmed) return 'Confirm receipt from the receiver-side PhonePe/bank history before approving.';
  if (String(reason || '').trim().length < 8) return 'Enter an audit reason of at least 8 characters.';
  return '';
}

module.exports = { phonePeCreditIntentUrl, validatePhonePeApproval };
