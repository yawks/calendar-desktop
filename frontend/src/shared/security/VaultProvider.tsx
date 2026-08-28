import { get, set } from 'idb-keyval';
import { createContext, FormEvent, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { decryptVault, decryptVaultWithKey, deriveVaultKey, EncryptedVault, encryptVaultWithKey, exportVaultKey, generateVaultKey, importVaultKey, vaultSalt } from './vaultCrypto';
import { biometricApiAvailable, biometricUnlockAvailable, disableBiometricUnlock, enableBiometricUnlock, hasBiometricUnlock, unlockWithBiometrics } from './biometricUnlock';
import { CloudDownload, Fingerprint, LockKeyhole, QrCode } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { platform } from '../platform';
import { getTauriInvoke } from '../platform/tauriRuntime';
import { ConfigSyncConflictError, decodeConfigInvitation, encodeConfigInvitation, fetchRemoteVault, NextcloudConfigLocation, putRemoteVault, RemoteVaultDocument } from '../api/configSyncApi';
const DB_KEY = 'courrier-encrypted-vault-v1';
const ITERATIONS = 600_000;
const LOCK_AFTER_MS = 30 * 60 * 1000;
const BIOMETRIC_TIMEOUT_MS = 15_000;
const CONFIG_SYNC_KEY = 'courrier:config-sync-v1';
const DEVICE_ID_KEY = 'courrier:device-id';
const AUTO_SYNC_DELAY_MS = 2_000;
const LEGACY_KEYS = [
  'calendar-desktop-google-accounts',
  'calendar-desktop-exchange-accounts',
  'calendar-desktop-imap-accounts',
  'calendar-desktop-jmap-accounts',
  'calendar-desktop-calendars',
  'logodev-token',
] as const;

type VaultPayload = Record<string, unknown>;
type ConfigSyncStatus = 'disabled' | 'idle' | 'syncing' | 'synced' | 'conflict' | 'error';
interface ConfigSyncSettings extends NextcloudConfigLocation { enabled: boolean; etag?: string; revision: number; dirty?: boolean }

function bytesToRecoveryKey(bytes: ArrayBuffer): string {
  let binary = ''; new Uint8Array(bytes).forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function recoveryKeyToBytes(value: string): ArrayBuffer {
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, char => char.charCodeAt(0)).buffer;
}

function deviceId(): string {
  let value = localStorage.getItem(DEVICE_ID_KEY);
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(DEVICE_ID_KEY, value); }
  return value;
}

function portablePayload(payload: VaultPayload): VaultPayload {
  const next = { ...payload };
  delete next[CONFIG_SYNC_KEY];
  return next;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Biometric authentication timed out')), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
interface VaultContextValue {
  read<T>(key: string, fallback: T): T;
  write<T>(key: string, value: T): void;
  lock(): void;
  biometricAvailable: boolean;
  biometricEnabled: boolean;
  enableBiometrics(): Promise<void>;
  disableBiometrics(): Promise<void>;
  backupToNextcloud(location: NextcloudConfigLocation): Promise<void>;
  configSyncSettings: ConfigSyncSettings | null;
  configSyncStatus: ConfigSyncStatus;
  configSyncInvitation: string | null;
  disableConfigSync(): void;
  resolveConfigSyncConflict(strategy: 'local' | 'remote'): Promise<void>;
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

function VaultScreen({ exists, busy, error, biometricEnabled, onSubmit, onBiometricUnlock, onRestore }: Readonly<{
  exists: boolean;
  busy: boolean;
  error: string;
  biometricEnabled: boolean;
  onSubmit(password: string): Promise<void>;
  onBiometricUnlock(): Promise<void>;
  onRestore(location: NextcloudConfigLocation, masterPassword: string): Promise<void>;
}>) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [restoreMode, setRestoreMode] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [nextcloudPassword, setNextcloudPassword] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [invitation, setInvitation] = useState('');
  const applyInvitation = (raw: string) => {
    const decoded = decodeConfigInvitation(raw);
    setServerUrl(decoded.serverUrl); setUsername(decoded.username); setRecoveryKey(decoded.recoveryKey); setRestoreMode(true);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!exists && password !== confirmation) return;
    if (restoreMode) void onRestore({ serverUrl, username, password: nextcloudPassword, recoveryKey }, password);
    else void onSubmit(password);
  };
  const mismatch = !exists && confirmation.length > 0 && password !== confirmation;
  return <main className="vault-screen">
    <div className="vault-layout">
      <div className="vault-brand vault-brand--top" aria-label={t('vault.appName')}>
        <img src="/icon.png" alt="" className="vault-brand__logo" />
        <span>{t('vault.appName')}</span>
      </div>
      <div className="vault-panel">
      <form className="vault-form" onSubmit={submit} onFocusCapture={event => {
        if (!platform.isNativeAndroid || !(event.target instanceof HTMLInputElement)) return;
        const field = event.target;
        window.setTimeout(() => field.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
      }}>
      <header className="vault-form__header">
        <div className="vault-security-icon" aria-hidden="true"><LockKeyhole size={26} strokeWidth={2.25} /></div>
        <h1>{t(exists ? 'vault.unlock' : restoreMode ? 'vault.restore' : 'vault.create')}</h1>
        <p>{t(exists ? 'vault.unlockDescription' : restoreMode ? 'vault.restoreDescription' : 'vault.createDescription')}</p>
      </header>
      <div className="vault-fields">
        {restoreMode && <>
          <label htmlFor="vault-invitation">{t('vault.invitation')}</label>
          <input id="vault-invitation" autoComplete="off" placeholder="courrier://config/import…" value={invitation} onChange={event => setInvitation(event.target.value)} onBlur={() => { if (invitation.trim()) { try { applyInvitation(invitation); } catch { /* manual fields remain available */ } } }} />
          {platform.scanConfigQr && <button className="vault-fields__action" type="button" onClick={() => void platform.scanConfigQr?.().then(raw => { setInvitation(raw); applyInvitation(raw); })}><QrCode size={18} />{t('vault.scanQr')}</button>}
          <label htmlFor="vault-nextcloud-url">{t('vault.nextcloudUrl')}</label>
          <input id="vault-nextcloud-url" autoComplete="url" type="url" required placeholder="https://cloud.example.com" value={serverUrl} onChange={event => setServerUrl(event.target.value)} />
          <label htmlFor="vault-nextcloud-user">{t('vault.nextcloudUsername')}</label>
          <input id="vault-nextcloud-user" autoComplete="username" required value={username} onChange={event => setUsername(event.target.value)} />
          <label htmlFor="vault-nextcloud-password">{t('vault.nextcloudPassword')}</label>
          <input id="vault-nextcloud-password" autoComplete="current-password" type="password" required value={nextcloudPassword} onChange={event => setNextcloudPassword(event.target.value)} />
          <label htmlFor="vault-recovery-key">{t('vault.recoveryKey')}</label>
          <input id="vault-recovery-key" autoComplete="off" required value={recoveryKey} onChange={event => setRecoveryKey(event.target.value)} />
        </>}
        <label htmlFor="vault-password">{t(restoreMode ? 'vault.localPassword' : 'vault.masterPassword')}</label>
        <input id="vault-password" autoFocus={!biometricEnabled} autoComplete={exists ? 'current-password' : 'new-password'} type="password" minLength={12} required value={password} onChange={event => setPassword(event.target.value)} />
        {!exists && <><label htmlFor="vault-confirmation">{t(restoreMode ? 'vault.localPasswordConfirmation' : 'vault.confirmation')}</label><input id="vault-confirmation" autoComplete="new-password" type="password" minLength={12} required value={confirmation} onChange={event => setConfirmation(event.target.value)} /></>}
      </div>
      {(mismatch || error) && <p className="vault-form__error" role="alert">{mismatch ? t('vault.passwordMismatch') : t(error)}</p>}
      <div className="vault-form__actions">
        <button type="submit" disabled={busy || mismatch}>{busy ? t('vault.working') : t(exists ? 'vault.unlock' : restoreMode ? 'vault.restoreAction' : 'vault.create')}</button>
        {exists && biometricEnabled && <button type="button" disabled={busy} onClick={() => void onBiometricUnlock()}><Fingerprint size={18} aria-hidden="true" />{t('vault.unlockWithBiometrics')}</button>}
      </div>
      {!exists && <button className="vault-form__alternate" type="button" disabled={busy} onClick={() => setRestoreMode(value => !value)}>
        <CloudDownload size={18} aria-hidden="true" />{t(restoreMode ? 'vault.createInstead' : 'vault.restoreInstead')}
      </button>}
      {!exists && <small className="vault-form__notice">{t(restoreMode ? 'vault.localPasswordNotice' : 'vault.recoveryWarning')}</small>}
    </form>
      </div>
    </div>
  </main>;
}

function VaultLoading() {
  const { t } = useTranslation();
  return <main className="vault-loading" aria-label={t('vault.working')} aria-busy="true">
    <span className="vault-loading__spinner" aria-hidden="true" />
    <span>{t('vault.working')}</span>
  </main>;
}

export function VaultProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [stored, setStored] = useState<EncryptedVault | null | undefined>(undefined);
  const [payload, setPayload] = useState<VaultPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [desktopSessionChecked, setDesktopSessionChecked] = useState(() => !getTauriInvoke());
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(biometricApiAvailable());
  const [configSyncSettings, setConfigSyncSettings] = useState<ConfigSyncSettings | null>(null);
  const [configSyncStatus, setConfigSyncStatus] = useState<ConfigSyncStatus>('disabled');
  const [syncCheckNonce, setSyncCheckNonce] = useState(0);
  const keyRef = useRef<CryptoKey | null>(null);
  const payloadRef = useRef<VaultPayload>({});
  const writeQueue = useRef(Promise.resolve());
  const autoSyncTimer = useRef<number | null>(null);
  const remoteCheckRef = useRef('');
  const lock = useCallback(() => {
    keyRef.current = null;
    payloadRef.current = {};
    setPayload(null);
    void getTauriInvoke()?.('clear_vault_session_key').catch(error => {
      console.error('[Vault] failed to clear desktop session key', error);
    });
  }, []);
  const biometricAutoAttempted = useRef(false);

  useEffect(() => {
    const invoke = getTauriInvoke();
    if (!stored || !invoke || keyRef.current) {
      if (stored !== undefined) setDesktopSessionChecked(true);
      return;
    }
    void invoke<number[] | null>('get_vault_session_key').then(async rawKey => {
      if (!rawKey || keyRef.current) return;
      const key = await importVaultKey(Uint8Array.from(rawKey).buffer);
      const nextPayload = await decryptVaultWithKey<VaultPayload>(stored, key);
      keyRef.current = key;
      payloadRef.current = nextPayload;
      setPayload(nextPayload);
    }).catch(error => console.error('[Vault] desktop session unlock failed', error))
      .finally(() => setDesktopSessionChecked(true));
  }, [stored]);

  const rememberDesktopSession = useCallback((key: CryptoKey) => {
    const invoke = getTauriInvoke();
    if (!invoke) return;
    void exportVaultKey(key).then(rawKey => invoke('set_vault_session_key', {
      key: Array.from(new Uint8Array(rawKey)),
    })).catch(error => console.error('[Vault] desktop session key export failed', error));
  }, []);

  useEffect(() => {
    void Promise.all([get<EncryptedVault>(DB_KEY), hasBiometricUnlock(), biometricUnlockAvailable()]).then(([value, enabled, available]) => {
      setStored(value ?? null);
      setBiometricEnabled(enabled);
      setBiometricAvailable(available);
    });
  }, []);

  const persist = useCallback((next: VaultPayload) => {
    const key = keyRef.current;
    const vault = stored;
    if (!key || !vault) return;
    writeQueue.current = writeQueue.current.then(async () => {
      const encrypted = await encryptVaultWithKey(next, key, vaultSalt(vault), vault.kdf.iterations);
      await set(DB_KEY, encrypted);
    }).catch(error => console.error('[Vault] persistence failed', error));
  }, [stored]);

  useEffect(() => {
    if (!payload) return;
    const sync = payload[CONFIG_SYNC_KEY] as ConfigSyncSettings | undefined;
    setConfigSyncSettings(sync?.enabled ? sync : null);
    if (!sync?.enabled) setConfigSyncStatus('disabled');
    else setConfigSyncStatus(current => current === 'disabled' ? 'idle' : current);
  }, [payload]);

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
      rememberDesktopSession(key);
    } catch (cause) {
      console.error('[Vault] unlock/create failed', cause);
      setError(stored ? 'vault.invalidPassword' : 'vault.creationFailed');
    } finally { setBusy(false); }
  }, [stored, rememberDesktopSession]);

  const biometricUnlock = useCallback(async () => {
    if (!stored) return;
    setBusy(true); setError('');
    try {
      const key = await withTimeout(unlockWithBiometrics(), BIOMETRIC_TIMEOUT_MS);
      const nextPayload = await decryptVaultWithKey<VaultPayload>(stored, key);
      keyRef.current = key;
      payloadRef.current = nextPayload;
      setPayload(nextPayload);
      rememberDesktopSession(key);
    } catch (cause) {
      console.error('[Vault] biometric unlock failed', cause);
      setError('vault.biometricFailed');
    } finally { setBusy(false); }
  }, [stored, rememberDesktopSession]);

  const restore = useCallback(async (location: NextcloudConfigLocation, password: string) => {
    setBusy(true); setError('');
    try {
      const remote = await fetchRemoteVault(location);
      if (!remote.document) throw new Error('Remote configuration not found');
      if (!location.recoveryKey) throw new Error('Recovery key required');
      const syncKey = await importVaultKey(recoveryKeyToBytes(location.recoveryKey));
      const remotePayload = await decryptVaultWithKey<VaultPayload>(remote.document.vault, syncKey);
      const sync: ConfigSyncSettings = { ...location, recoveryKey: location.recoveryKey.trim(), enabled: true, etag: remote.etag, revision: remote.document.revision, dirty: false };
      const nextPayload = { ...remotePayload, [CONFIG_SYNC_KEY]: sync };
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const localKey = await deriveVaultKey(password, salt, ITERATIONS);
      const localVault = await encryptVaultWithKey(nextPayload, localKey, salt, ITERATIONS);
      await set(DB_KEY, localVault);
      keyRef.current = localKey;
      payloadRef.current = nextPayload;
      setStored(localVault);
      setPayload(nextPayload);
      setConfigSyncSettings(sync);
      setConfigSyncStatus('synced');
      rememberDesktopSession(localKey);
    } catch (cause) {
      console.error('[Vault] Nextcloud restore failed', cause);
      setError('vault.restoreFailed');
    } finally { setBusy(false); }
  }, [rememberDesktopSession]);

  const pushConfiguration = useCallback(async (location: NextcloudConfigLocation, etag?: string, revision = 0, overwrite = false) => {
    const vault = stored;
    if (!keyRef.current || !vault) throw new Error('Vault is locked');
    setConfigSyncStatus('syncing');
    let recoveryKey = location.recoveryKey?.trim();
    let syncKey: CryptoKey;
    if (recoveryKey) syncKey = await importVaultKey(recoveryKeyToBytes(recoveryKey));
    else { syncKey = await generateVaultKey(); recoveryKey = bytesToRecoveryKey(await exportVaultKey(syncKey)); }
    const encrypted = await encryptVaultWithKey(portablePayload(payloadRef.current), syncKey, crypto.getRandomValues(new Uint8Array(16)), vault.kdf.iterations);
    const document: RemoteVaultDocument = { format: 'courrier-config', version: 1, deviceId: deviceId(), revision: revision + 1, updatedAt: new Date().toISOString(), vault: encrypted };
    try {
      let expectedEtag = etag;
      if (overwrite) expectedEtag = (await fetchRemoteVault(location)).etag;
      await putRemoteVault(location, document, expectedEtag);
      const confirmed = await fetchRemoteVault(location);
      const sync: ConfigSyncSettings = { ...location, recoveryKey, enabled: true, etag: confirmed.etag, revision: document.revision, dirty: false };
      const next = { ...payloadRef.current, [CONFIG_SYNC_KEY]: sync };
      payloadRef.current = next; setPayload(next); setConfigSyncSettings(sync); persist(next);
      setConfigSyncStatus('synced');
    } catch (cause) {
      setConfigSyncStatus(cause instanceof ConfigSyncConflictError ? 'conflict' : 'error');
      throw cause;
    }
  }, [persist, stored]);

  const backupToNextcloud = useCallback(async (location: NextcloudConfigLocation) => {
    const remote = await fetchRemoteVault(location);
    const current = configSyncSettings;
    if (remote.exists && (!current || current.serverUrl !== location.serverUrl || current.username !== location.username)) {
      const pendingKey = location.recoveryKey ?? bytesToRecoveryKey(await exportVaultKey(await generateVaultKey()));
      const pending: ConfigSyncSettings = { ...location, recoveryKey: pendingKey, enabled: true, etag: remote.etag, revision: remote.document?.revision ?? 0, dirty: true };
      const next = { ...payloadRef.current, [CONFIG_SYNC_KEY]: pending };
      payloadRef.current = next; setPayload(next); setConfigSyncSettings(pending); persist(next);
      setConfigSyncStatus('conflict');
      throw new ConfigSyncConflictError();
    }
    await pushConfiguration(location, current?.etag ?? remote.etag, current?.revision ?? remote.document?.revision ?? 0);
  }, [configSyncSettings, pushConfiguration]);

  const disableConfigSync = useCallback(() => {
    const next = { ...payloadRef.current }; delete next[CONFIG_SYNC_KEY];
    payloadRef.current = next; setPayload(next); setConfigSyncSettings(null); setConfigSyncStatus('disabled'); persist(next);
  }, [persist]);

  const resolveConfigSyncConflict = useCallback(async (strategy: 'local' | 'remote') => {
    const sync = configSyncSettings;
    if (!sync) throw new Error('Config sync is disabled');
    if (strategy === 'local') { await pushConfiguration(sync, sync.etag, sync.revision, true); return; }
    const remote = await fetchRemoteVault(sync);
    if (!remote.document || !sync.recoveryKey) throw new Error('Remote configuration unavailable');
    const remotePayload = await decryptVaultWithKey<VaultPayload>(remote.document.vault, await importVaultKey(recoveryKeyToBytes(sync.recoveryKey)));
    const nextSync: ConfigSyncSettings = { ...sync, etag: remote.etag, revision: remote.document.revision, dirty: false };
    const next = { ...remotePayload, [CONFIG_SYNC_KEY]: nextSync };
    payloadRef.current = next; setPayload(next); setConfigSyncSettings(nextSync); persist(next); setConfigSyncStatus('synced');
    await writeQueue.current; window.location.reload();
  }, [configSyncSettings, persist, pushConfiguration]);

  useEffect(() => {
    const sync = configSyncSettings;
    if (!payload || !sync?.enabled || !sync.recoveryKey) return;
    const checkId = `${sync.serverUrl}|${sync.username}|${sync.etag ?? ''}|${sync.revision}|${sync.dirty === true}`;
    if (remoteCheckRef.current === checkId) return;
    remoteCheckRef.current = checkId;
    void fetchRemoteVault(sync).then(async remote => {
      if (!remote.document) { if (sync.dirty) await pushConfiguration(sync, undefined, sync.revision); return; }
      const remoteChanged = remote.etag !== sync.etag || remote.document.revision > sync.revision;
      if (remoteChanged && sync.dirty && remote.document.deviceId === deviceId()) {
        await pushConfiguration(sync, remote.etag, remote.document.revision);
        return;
      }
      if (remoteChanged && sync.dirty) { setConfigSyncStatus('conflict'); return; }
      if (remoteChanged) {
        const remotePayload = await decryptVaultWithKey<VaultPayload>(remote.document.vault, await importVaultKey(recoveryKeyToBytes(sync.recoveryKey!)));
        const nextSync: ConfigSyncSettings = { ...sync, etag: remote.etag, revision: remote.document.revision, dirty: false };
        const next = { ...remotePayload, [CONFIG_SYNC_KEY]: nextSync };
        payloadRef.current = next; setPayload(next); setConfigSyncSettings(nextSync); persist(next); setConfigSyncStatus('synced');
        await writeQueue.current; window.location.reload();
      } else if (sync.dirty) await pushConfiguration(sync, sync.etag, sync.revision);
      else setConfigSyncStatus('synced');
    }).catch(error => { console.error('[ConfigSync] startup check failed', error); setConfigSyncStatus('error'); });
  }, [configSyncSettings, payload, persist, pushConfiguration, syncCheckNonce]);
  useEffect(() => {
    if (!configSyncSettings?.enabled) return;
    const timer = window.setInterval(() => { remoteCheckRef.current = ''; setSyncCheckNonce(value => value + 1); }, 60_000);
    return () => window.clearInterval(timer);
  }, [configSyncSettings?.enabled]);

  const enableBiometrics = useCallback(async () => {
    const key = keyRef.current;
    if (!key) throw new Error('Vault is locked');
    await enableBiometricUnlock(key);
    setBiometricEnabled(true);
  }, []);

  const disableBiometrics = useCallback(async () => {
    await disableBiometricUnlock();
    setBiometricEnabled(false);
  }, []);

  useEffect(() => {
    if (payload !== null) {
      biometricAutoAttempted.current = false;
      return;
    }
    if (!stored || !biometricEnabled || busy || biometricAutoAttempted.current) return;
    biometricAutoAttempted.current = true;
    void biometricUnlock();
  }, [payload, stored, biometricEnabled, busy, biometricUnlock]);

  useEffect(() => {
    if (!payload) return;
    let timer = window.setTimeout(lock, LOCK_AFTER_MS);
    const activity = () => { window.clearTimeout(timer); timer = window.setTimeout(lock, LOCK_AFTER_MS); };
    for (const event of ['pointerdown', 'keydown'] as const) window.addEventListener(event, activity, { passive: true });
    return () => { window.clearTimeout(timer); for (const event of ['pointerdown', 'keydown'] as const) window.removeEventListener(event, activity); };
  }, [payload, lock]);

  const read = useCallback(<T,>(key: string, fallback: T): T => (payloadRef.current[key] as T | undefined) ?? fallback, []);
  useEffect(() => {
    void platform.setVaultLocked(payload === null);
  }, [payload]);

  const write = useCallback(<T,>(key: string, value: T) => {
    if (valuesEqual(payloadRef.current[key], value)) return;
    let next = { ...payloadRef.current, [key]: value };
    let activeSync = configSyncSettings;
    if (activeSync?.enabled && key !== CONFIG_SYNC_KEY) {
      activeSync = { ...activeSync, dirty: true };
      next = { ...next, [CONFIG_SYNC_KEY]: activeSync };
      setConfigSyncSettings(activeSync);
    }
    payloadRef.current = next;
    setPayload(next);
    persist(next);
    if (activeSync?.enabled && key !== CONFIG_SYNC_KEY && configSyncStatus !== 'conflict') {
      if (autoSyncTimer.current !== null) window.clearTimeout(autoSyncTimer.current);
      autoSyncTimer.current = window.setTimeout(() => {
        void pushConfiguration(activeSync!, activeSync!.etag, activeSync!.revision)
          .catch(error => console.error('[ConfigSync] automatic sync failed', error));
      }, AUTO_SYNC_DELAY_MS);
    }
  }, [configSyncSettings, configSyncStatus, persist, pushConfiguration]);
  useEffect(() => () => { if (autoSyncTimer.current !== null) window.clearTimeout(autoSyncTimer.current); }, []);

  const configSyncInvitation = useMemo(() => configSyncSettings ? encodeConfigInvitation(configSyncSettings) : null, [configSyncSettings]);
  const contextValue = useMemo(() => ({
    read, write, lock,
    biometricAvailable,
    biometricEnabled,
    enableBiometrics,
    disableBiometrics,
    backupToNextcloud,
    configSyncSettings,
    configSyncStatus,
    configSyncInvitation,
    disableConfigSync,
    resolveConfigSyncConflict,
  }), [read, write, lock, biometricAvailable, biometricEnabled, enableBiometrics, disableBiometrics, backupToNextcloud, configSyncSettings, configSyncStatus, configSyncInvitation, disableConfigSync, resolveConfigSyncConflict]);

  if (stored === undefined || !desktopSessionChecked) return <VaultLoading />;
  if (!payload) return <VaultScreen exists={stored !== null} busy={busy} error={error} biometricEnabled={biometricEnabled} onSubmit={submit} onBiometricUnlock={biometricUnlock} onRestore={restore} />;
  return <VaultContext.Provider value={contextValue}>{children}</VaultContext.Provider>;
}

export function useVault() {
  const value = useContext(VaultContext);
  if (!value) throw new Error('useVault must be used inside VaultProvider');
  return value;
}
