import { describe, expect, it } from 'vitest';
import { decryptVault, encryptVault } from './vaultCrypto';

describe('encrypted vault', () => {
  it('round-trips data and rejects a wrong password', async () => {
    const vault = await encryptVault({ token: 'secret', accounts: [1] }, 'correct horse battery staple', 10);
    expect(JSON.stringify(vault)).not.toContain('secret');
    await expect(decryptVault(vault, 'wrong password')).rejects.toThrow();
    const { payload } = await decryptVault<{ token: string }>(vault, 'correct horse battery staple');
    expect(payload.token).toBe('secret');
  });
});
