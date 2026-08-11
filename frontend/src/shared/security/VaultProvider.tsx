import { get, set } from 'idb-keyval';
import { createContext, FormEvent, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { decryptVault, deriveVaultKey, EncryptedVault, encryptVaultWithKey, vaultSalt } from './vaultCrypto';
import { useTranslation } from 'react-i18next';

const DB_KEY = 'courrier-encrypted-vault-v1';
const ITERATIONS = 600_000;
const LOCK_AFTER_MS = 30 * 60 * 1000;
const LEGACY_KEYS = [
  'calendar-desktop-google-accounts',
  'calendar-desktop-exchange-accounts',
  'calendar-desktop-imap-accounts',
  'calendar-desktop-jmap-accounts',
  'calendar-desktop-calendars',
  'logodev-token',
] as const;

type VaultPayload = Record<string, unknown>;
interface VaultContextValue {
  read<T>(key: string, fallback: T): T;
  write<T>(key: string, value: T): void;
  lock(): void;
}

const VaultContext = createContext<VaultContextValue | null>(null);

function legacyPayload(): VaultPayload {
  const payload: VaultPayload = {};
  for (const key of LEGACY_KEYS) {
    const value = localStorage.getItem(key);
    if (!value) continue;
    try { payload[key] = JSON.parse(value) as unknown; } catch { if (key === 'logodev-token') payload[key] = value; }
  }
  return payload;
}

function VaultScreen({ exists, busy, error, onSubmit }: Readonly<{
  exists: boolean;
  busy: boolean;
  error: string;
  onSubmit(password: string): Promise<void>;
}>) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!exists && password !== confirmation) return;
    void onSubmit(password);
  };
  const mismatch = !exists && confirmation.length > 0 && password !== confirmation;
  return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg-primary, #111827)' }}>
    <form onSubmit={submit} style={{ width: 'min(420px, 100%)', padding: 28, borderRadius: 14, background: 'var(--bg-secondary, #1f2937)', color: 'var(--text-primary, white)', boxShadow: '0 18px 50px #0005' }}>
      <h1 style={{ marginTop: 0 }}>{t('vault.appName')}</h1>
      <p>{t(exists ? 'vault.unlockDescription' : 'vault.createDescription')}</p>
      <label htmlFor="vault-password">{t('vault.masterPassword')}</label>
      <input id="vault-password" autoFocus autoComplete={exists ? 'current-password' : 'new-password'} type="password" minLength={12} required value={password} onChange={event => setPassword(event.target.value)} style={{ width: '100%', boxSizing: 'border-box', margin: '8px 0 16px', padding: 10 }} />
      {!exists && <><label htmlFor="vault-confirmation">{t('vault.confirmation')}</label><input id="vault-confirmation" autoComplete="new-password" type="password" minLength={12} required value={confirmation} onChange={event => setConfirmation(event.target.value)} style={{ width: '100%', boxSizing: 'border-box', margin: '8px 0 16px', padding: 10 }} /></>}
      {(mismatch || error) && <p role="alert" style={{ color: '#fca5a5' }}>{mismatch ? t('vault.passwordMismatch') : t(error)}</p>}
      <button type="submit" disabled={busy || mismatch} style={{ width: '100%', padding: 11 }}>{busy ? t('vault.working') : t(exists ? 'vault.unlock' : 'vault.create')}</button>
      {!exists && <small style={{ display: 'block', marginTop: 14, opacity: .75 }}>{t('vault.recoveryWarning')}</small>}
    </form>
  </main>;
}

export function VaultProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [stored, setStored] = useState<EncryptedVault | null | undefined>(undefined);
  const [payload, setPayload] = useState<VaultPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const keyRef = useRef<CryptoKey | null>(null);
  const payloadRef = useRef<VaultPayload>({});
  const writeQueue = useRef(Promise.resolve());
  const lock = useCallback(() => { keyRef.current = null; payloadRef.current = {}; setPayload(null); }, []);

  useEffect(() => { void get<EncryptedVault>(DB_KEY).then(value => setStored(value ?? null)); }, []);

  const persist = useCallback((next: VaultPayload) => {
    const key = keyRef.current;
    const vault = stored;
    if (!key || !vault) return;
    writeQueue.current = writeQueue.current.then(async () => {
      const encrypted = await encryptVaultWithKey(next, key, vaultSalt(vault), vault.kdf.iterations);
      await set(DB_KEY, encrypted);
    }).catch(error => console.error('[Vault] persistence failed', error));
  }, [stored]);

  const submit = useCallback(async (password: string) => {
    setBusy(true); setError('');
    if (!globalThis.isSecureContext || !globalThis.crypto?.subtle) {
      console.error('[Vault] Web Crypto unavailable: Courrier must be opened over HTTPS or localhost.');
      setError('vault.secureContextRequired');
      setBusy(false);
      return;
    }
    try {
      let nextPayload: VaultPayload;
      let key: CryptoKey;
      let nextStored: EncryptedVault;
      if (stored) {
        const decrypted = await decryptVault<VaultPayload>(stored, password);
        nextPayload = decrypted.payload;
        key = decrypted.key;
        nextStored = stored;
      } else {
        nextPayload = legacyPayload();
        const salt = crypto.getRandomValues(new Uint8Array(16));
        key = await deriveVaultKey(password, salt, ITERATIONS);
        nextStored = await encryptVaultWithKey(nextPayload, key, salt, ITERATIONS);
        await set(DB_KEY, nextStored);
        for (const legacyKey of LEGACY_KEYS) localStorage.removeItem(legacyKey);
      }
      keyRef.current = key;
      payloadRef.current = nextPayload;
      setStored(nextStored);
      setPayload(nextPayload);
    } catch (cause) {
      console.error('[Vault] unlock/create failed', cause);
      setError(stored ? 'vault.invalidPassword' : 'vault.creationFailed');
    } finally { setBusy(false); }
  }, [stored]);

  useEffect(() => {
    if (!payload) return;
    let timer = window.setTimeout(lock, LOCK_AFTER_MS);
    const activity = () => { window.clearTimeout(timer); timer = window.setTimeout(lock, LOCK_AFTER_MS); };
    for (const event of ['pointerdown', 'keydown'] as const) window.addEventListener(event, activity, { passive: true });
    return () => { window.clearTimeout(timer); for (const event of ['pointerdown', 'keydown'] as const) window.removeEventListener(event, activity); };
  }, [payload, lock]);

  const read = useCallback(<T,>(key: string, fallback: T): T => (payloadRef.current[key] as T | undefined) ?? fallback, []);
  const write = useCallback(<T,>(key: string, value: T) => {
    const next = { ...payloadRef.current, [key]: value };
    payloadRef.current = next;
    setPayload(next);
    persist(next);
  }, [persist]);
  const contextValue = useMemo(() => ({ read, write, lock }), [read, write, lock]);

  if (stored === undefined) return null;
  if (!payload) return <VaultScreen exists={stored !== null} busy={busy} error={error} onSubmit={submit} />;
  return <VaultContext.Provider value={contextValue}>{children}</VaultContext.Provider>;
}

export function useVault() {
  const value = useContext(VaultContext);
  if (!value) throw new Error('useVault must be used inside VaultProvider');
  return value;
}
