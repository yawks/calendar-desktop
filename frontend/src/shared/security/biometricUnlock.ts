import { del, get, set } from 'idb-keyval';
import { exportVaultKey, importVaultKey } from './vaultCrypto';

const STORAGE_KEY = 'courrier-biometric-unlock-v1';
const AAD = new TextEncoder().encode('courrier-biometric-unlock-v1');

interface BiometricRecord {
  version: 1;
  credentialId: string;
  prfSalt: string;
  iv: string;
  wrappedKey: string;
}

interface PrfResult { enabled?: boolean; results?: { first?: ArrayBuffer } }
type PrfExtensions = AuthenticationExtensionsClientOutputs & { prf?: PrfResult };

function toBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): ArrayBuffer {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function randomBytes(length: number): ArrayBuffer {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(bytes);
  return bytes.buffer;
}

function prfSecret(credential: PublicKeyCredential): ArrayBuffer | null {
  const extensions = credential.getClientExtensionResults() as PrfExtensions;
  return extensions.prf?.results?.first ?? null;
}

async function wrappingKey(secret: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', secret, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export function biometricApiAvailable(): boolean {
  return globalThis.isSecureContext && typeof PublicKeyCredential !== 'undefined' && !!navigator.credentials;
}

export async function hasBiometricUnlock(): Promise<boolean> {
  return !!await get<BiometricRecord>(STORAGE_KEY);
}

export async function enableBiometricUnlock(vaultKey: CryptoKey): Promise<void> {
  if (!biometricApiAvailable()) throw new Error('WebAuthn is unavailable');
  const prfSalt = randomBytes(32);
  const userId = randomBytes(32);
  const credential = await navigator.credentials.create({ publicKey: {
    challenge: randomBytes(32),
    rp: { name: 'Courrier' },
    user: { id: userId, name: 'local-vault', displayName: 'Courrier local vault' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
    timeout: 60_000,
    attestation: 'none',
    extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
  } }) as PublicKeyCredential | null;
  if (!credential) throw new Error('Biometric enrollment was cancelled');

  const creationExtensions = credential.getClientExtensionResults() as PrfExtensions;
  if (creationExtensions.prf?.enabled !== true && !prfSecret(credential)) {
    throw new Error('WebAuthn PRF is unavailable for this authenticator');
  }

  // Chrome normally reports PRF support during creation, then returns the
  // actual PRF output on the first assertion for the new credential.
  let secret = prfSecret(credential);
  if (!secret) {
    const assertion = await navigator.credentials.get({ publicKey: {
      challenge: randomBytes(32),
      allowCredentials: [{ type: 'public-key', id: credential.rawId, transports: ['internal'] }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
    } }) as PublicKeyCredential | null;
    if (!assertion) throw new Error('Biometric enrollment confirmation was cancelled');
    secret = prfSecret(assertion);
  }
  if (!secret) throw new Error('WebAuthn PRF is unavailable for this authenticator');

  const iv = randomBytes(12);
  const rawVaultKey = await exportVaultKey(vaultKey);
  const wrappedKey = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, await wrappingKey(secret), rawVaultKey);
  await set(STORAGE_KEY, {
    version: 1,
    credentialId: toBase64Url(credential.rawId),
    prfSalt: toBase64Url(prfSalt),
    iv: toBase64Url(iv),
    wrappedKey: toBase64Url(wrappedKey),
  } satisfies BiometricRecord);
}

export async function unlockWithBiometrics(): Promise<CryptoKey> {
  const record = await get<BiometricRecord>(STORAGE_KEY);
  if (!record || record.version !== 1) throw new Error('Biometric unlock is not configured');
  const credential = await navigator.credentials.get({ publicKey: {
    challenge: randomBytes(32),
    allowCredentials: [{ type: 'public-key', id: fromBase64Url(record.credentialId), transports: ['internal'] }],
    userVerification: 'required',
    timeout: 60_000,
    extensions: { prf: { eval: { first: fromBase64Url(record.prfSalt) } } } as AuthenticationExtensionsClientInputs,
  } }) as PublicKeyCredential | null;
  if (!credential) throw new Error('Biometric unlock was cancelled');
  const secret = prfSecret(credential);
  if (!secret) throw new Error('WebAuthn PRF is unavailable for this authenticator');
  const rawKey = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(record.iv), additionalData: AAD },
    await wrappingKey(secret),
    fromBase64Url(record.wrappedKey),
  );
  return importVaultKey(rawKey);
}

export async function disableBiometricUnlock(): Promise<void> {
  await del(STORAGE_KEY);
}
