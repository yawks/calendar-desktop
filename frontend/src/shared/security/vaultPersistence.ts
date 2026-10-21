import { get, update } from 'idb-keyval';
import { decryptVaultWithKey, EncryptedVault, encryptVaultWithKey, vaultSalt } from './vaultCrypto';

/** Read the shared local snapshot rather than a window's stale in-memory copy. */
export async function readPersistedVault(
  storageKey: string,
  fallbackVault: EncryptedVault,
  key: CryptoKey,
): Promise<Record<string, unknown>> {
  const latest = await get<EncryptedVault>(storageKey);
  return decryptVaultWithKey<Record<string, unknown>>(latest ?? fallbackVault, key);
}

/** Commit only the changed fields, retaining writes made by other windows. */
export async function persistVaultFields(
  storageKey: string,
  fallbackVault: EncryptedVault,
  key: CryptoKey,
  payload: Record<string, unknown>,
  changedKeys: readonly string[],
): Promise<EncryptedVault> {
  for (;;) {
    const current = await get<EncryptedVault>(storageKey);
    const base = current ?? fallbackVault;
    const merged = await decryptVaultWithKey<Record<string, unknown>>(base, key);
    for (const field of changedKeys) {
      if (Object.prototype.hasOwnProperty.call(payload, field)) merged[field] = payload[field];
      else delete merged[field];
    }
    const encrypted = await encryptVaultWithKey(merged, key, vaultSalt(base), base.kdf.iterations);
    let committed = false;
    await update<EncryptedVault | undefined>(storageKey, latest => {
      // IndexedDB makes this comparison and write atomic across windows.
      if (latest?.cipher.data !== current?.cipher.data) return latest;
      committed = true;
      return encrypted;
    });
    if (committed) return encrypted;
  }
}
