export interface EncryptedVault {
  version: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string; data: string };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function asBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export async function deriveVaultKey(password: string, salt: Uint8Array, iterations = 600_000): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: asBuffer(salt), iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptVault(payload: unknown, password: string, iterations = 600_000): Promise<EncryptedVault> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveVaultKey(password, salt, iterations);
  return encryptVaultWithKey(payload, key, salt, iterations);
}

export async function encryptVaultWithKey(payload: unknown, key: CryptoKey, salt: Uint8Array, iterations: number): Promise<EncryptedVault> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(payload));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode('courrier-vault-v1') },
    key,
    plaintext,
  );
  return {
    version: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv), data: toBase64(new Uint8Array(encrypted)) },
  };
}

export async function decryptVault<T>(vault: EncryptedVault, password: string): Promise<{ payload: T; key: CryptoKey }> {
  if (vault.version !== 1 || vault.kdf.name !== 'PBKDF2' || vault.cipher.name !== 'AES-GCM') {
    throw new Error('Unsupported vault format');
  }
  const salt = fromBase64(vault.kdf.salt);
  const key = await deriveVaultKey(password, salt, vault.kdf.iterations);
  return { payload: await decryptVaultWithKey<T>(vault, key), key };
}

export async function decryptVaultWithKey<T>(vault: EncryptedVault, key: CryptoKey): Promise<T> {
  if (vault.version !== 1 || vault.kdf.name !== 'PBKDF2' || vault.cipher.name !== 'AES-GCM') {
    throw new Error('Unsupported vault format');
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: asBuffer(fromBase64(vault.cipher.iv)), additionalData: encoder.encode('courrier-vault-v1') },
    key,
    asBuffer(fromBase64(vault.cipher.data)),
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

export async function exportVaultKey(key: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey('raw', key);
}

export async function importVaultKey(raw: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

export async function generateVaultKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export function vaultSalt(vault: EncryptedVault): Uint8Array {
  return fromBase64(vault.kdf.salt);
}
