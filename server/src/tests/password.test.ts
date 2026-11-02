import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../lib/password.js';

describe('PaisaPay password hashing', () => {
  it('stores a salted hash and accepts only the matching password', async () => {
    const first = await hashPassword('1234');
    const second = await hashPassword('1234');
    expect(first).not.toContain('1234');
    expect(first).not.toBe(second);
    await expect(verifyPassword('1234', first)).resolves.toBe(true);
    await expect(verifyPassword('wrong', first)).resolves.toBe(false);
  });

  it('rejects malformed hashes safely', async () => {
    await expect(verifyPassword('1234', 'not-a-hash')).resolves.toBe(false);
  });
});
