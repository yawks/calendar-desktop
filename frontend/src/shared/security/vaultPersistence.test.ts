import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptVault, decryptVaultWithKey, encryptVault, EncryptedVault } from './vaultCrypto';
import { persistVaultFields } from './vaultPersistence';

const storage = vi.hoisted(() => ({ vault: undefined as EncryptedVault | undefined, reads: 0 }));
vi.mock('idb-keyval', () => ({
  get: async () => { storage.reads++; return storage.vault; },
  update: async (_key: string, updater: (value: EncryptedVault | undefined) => EncryptedVault) => {
    storage.vault = updater(storage.vault);
  },
}));
const calendars = [{ id: 'calendar', groupId: 'default' }];
const initial = { calendars, accounts: [{ token: 'old' }], groups: [{ id: 'work' }], tags: [{ id: 'focus' }] };
async function setup() {
  const vault = await encryptVault(initial, 'test password', 10);
  const { key } = await decryptVault(vault, 'test password');
  storage.vault = vault;
  return { vault, key };
}
beforeEach(() => { storage.vault = undefined; storage.reads = 0; });
describe('vault field persistence', () => {
  it('preserves a calendar move when a stale mail window saves its accounts', async () => {
    const { vault, key } = await setup();
    const moved = [{ id: 'calendar', groupId: 'work' }];
    await persistVaultFields('vault', vault, key, { ...initial, calendars: moved }, ['calendars']);
    await persistVaultFields('vault', vault, key, { ...initial, accounts: [{ token: 'new' }] }, ['accounts']);
    expect(await decryptVaultWithKey(storage.vault!, key)).toEqual({ ...initial, calendars: moved, accounts: [{ token: 'new' }] });
  });

  it('retries concurrent writes so neither window loses its changes', async () => {
    const { vault, key } = await setup();
    const moved = [{ id: 'calendar', groupId: 'work' }];
    await Promise.all([
      persistVaultFields('vault', vault, key, { ...initial, calendars: moved }, ['calendars']),
      persistVaultFields('vault', vault, key, { ...initial, tags: [{ id: 'updated' }] }, ['tags']),
    ]);
    expect(storage.reads).toBeGreaterThanOrEqual(3);
    expect(await decryptVaultWithKey(storage.vault!, key)).toEqual({ ...initial, calendars: moved, tags: [{ id: 'updated' }] });
  });

  it('supports explicit replacement and deletion of shared fields', async () => {
    const { vault, key } = await setup();
    await persistVaultFields('vault', vault, key, { calendars: [] }, ['calendars', 'tags', 'groups']);
    expect(await decryptVaultWithKey(storage.vault!, key)).toEqual({ calendars: [], accounts: initial.accounts });
  });

  it('does not overwrite persisted data if the encryption key is wrong', async () => {
    const { vault } = await setup();
    const other = await encryptVault({}, 'another password', 10);
    const { key } = await decryptVault(other, 'another password');
    await expect(persistVaultFields('vault', vault, key, {}, ['calendars'])).rejects.toThrow();
    expect(storage.vault).toBe(vault);
  });
});
