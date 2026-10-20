import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Bell, Check, Copy, Database, Fingerprint, Info, Lock, Sun } from 'lucide-react';
import { useFontSize, FontSizePreference } from '../../shared/store/FontSizeStore';
import { useLanguage } from '../../shared/store/LanguageStore';
import { LanguagePreference } from '../../i18n';
import { useLayout, AppLayout } from '../../shared/store/LayoutStore';
import { useTheme, ThemePreference } from '../../shared/store/ThemeStore';
import { useVault } from '../../shared/security/VaultProvider';
import { useOfflineMailSettings } from '../../shared/store/OfflineMailStore';

import { isTauriRuntime } from '../../shared/platform/tauriRuntime';
import { useMailNotificationsSettings } from '../../shared/store/MailNotificationStore';
export function PreferencesSection({ section }: { section: 'general' | 'sync' | 'security' | 'about' }) {
  const { t } = useTranslation();
  const { preference, setPreference } = useLanguage();
  const { layout, setLayout } = useLayout();
  const { preference: themePref, setPreference: setThemePref } = useTheme();
  const { fontSize, setFontSize } = useFontSize();
  const { lock, biometricAvailable, biometricEnabled, enableBiometrics, disableBiometrics } = useVault();
  const { settings: offlineMail, updateSettings: updateOfflineMail } = useOfflineMailSettings();
  const [biometricBusy, setBiometricBusy] = useState(false);
  const { settings: mailNotifications, supported: notificationSupported, permission: notificationPermission, enable: enableNotifications, disable: disableNotifications } = useMailNotificationsSettings();
  const [biometricDiagnostic, setBiometricDiagnostic] = useState('');
  const [diagnosticCopied, setDiagnosticCopied] = useState(false);
  const buildCommitId = import.meta.env.VITE_APP_COMMIT_ID || t('settings.buildInfo.unknown');
  const buildDate = new Date(import.meta.env.VITE_APP_COMMIT_DATE || '');
  const formattedBuildDate = Number.isNaN(buildDate.getTime())
    ? t('settings.buildInfo.unknown')
    : buildDate.toLocaleString();

  const createBiometricDiagnostic = async (cause: unknown): Promise<string> => {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    let platformAuthenticator: boolean | string = 'unknown';
    try {
      platformAuthenticator = typeof PublicKeyCredential !== 'undefined'
        && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch (probeError) {
      platformAuthenticator = `probe failed: ${probeError instanceof Error ? probeError.message : String(probeError)}`;
    }
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      errorName: error.name,
      errorMessage: error.message,
      secureContext: globalThis.isSecureContext,
      origin: globalThis.location.origin,
      standalone: globalThis.matchMedia('(display-mode: standalone)').matches,
      webAuthn: typeof PublicKeyCredential !== 'undefined',
      platformAuthenticator,
      userAgent: navigator.userAgent,
    }, null, 2);
  };

  const toggleBiometrics = async () => {
    setBiometricBusy(true);
    setBiometricDiagnostic('');
    setDiagnosticCopied(false);
    try {
      if (biometricEnabled) await disableBiometrics();
      else await enableBiometrics();
    } catch (cause) {
      console.error('[Vault] biometric configuration failed', cause);
      setBiometricDiagnostic(await createBiometricDiagnostic(cause));
    } finally {
      setBiometricBusy(false);
    }
  };

  const copyBiometricDiagnostic = async () => {
    await navigator.clipboard.writeText(biometricDiagnostic);
    setDiagnosticCopied(true);
  };

  return (
    <div className="preferences-section">
      {section === 'general' && <section className="native-settings-card preferences-card">
        <header className="native-settings-card__header"><div className="native-settings-card__icon" aria-hidden="true"><Sun size={20} /></div><div><h3>{t('settings.navigation.customization')}</h3></div></header>
        <div className="native-settings-grid">
          <label className="native-settings-field"><span>{t('settings.language.sectionTitle')}</span><select value={preference} onChange={event => setPreference(event.target.value as LanguagePreference)}>{(['system', 'fr', 'en'] as const).map(value => <option key={value} value={value}>{t(`settings.language.${value}`)}</option>)}</select></label>
          <label className="native-settings-field"><span>{t('settings.theme.sectionTitle')}</span><select value={themePref} onChange={event => setThemePref(event.target.value as ThemePreference)}>{(['system', 'light', 'dark'] as const).map(value => <option key={value} value={value}>{t(`settings.theme.${value}`)}</option>)}</select></label>
          <label className="native-settings-field"><span>{t('settings.fontSize.sectionTitle')}</span><select value={fontSize} onChange={event => setFontSize(event.target.value as FontSizePreference)}>{(['small', 'medium', 'intermediate', 'large'] as const).map(value => <option key={value} value={value}>{t(`settings.fontSize.${value}`)}</option>)}</select></label>
          {isTauriRuntime() && <label className="native-settings-field preferences-layout-section"><span>{t('settings.layout.sectionTitle')}</span><select value={layout} onChange={event => setLayout(event.target.value as AppLayout)}>{(['tabbed', 'windows'] as const).map(value => <option key={value} value={value}>{t(`settings.layout.${value}`)}</option>)}</select><small className="config-setting-help">{t('settings.layout.hint')}</small></label>}
        </div>
        <p className="config-font-preview">{t('settings.navigation.textPreview')}</p>
      </section>}
      {section === 'sync' && <section className="native-settings-card preferences-card">
        <header className="native-settings-card__header"><div className="native-settings-card__icon" aria-hidden="true"><Bell size={20} /></div><div><h3>{t('settings.mailNotifications.sectionTitle')}</h3><p>{notificationPermission === 'denied' ? t('settings.mailNotifications.blocked') : !notificationSupported ? t('settings.mailNotifications.unavailable') : t('settings.mailNotifications.hint')}</p></div></header>
        <label className="preferences-toggle"><input type="checkbox" checked={mailNotifications.enabled} disabled={!notificationSupported || notificationPermission === 'denied'} onChange={event => { if (event.target.checked) void enableNotifications(); else disableNotifications(); }} /><span>{t('settings.mailNotifications.enabled')}</span></label>
      </section>}
      {section === 'security' && <>
      <section className="native-settings-card offline-mail-card" aria-labelledby="offline-mail-title">
        <header className="native-settings-card__header">
          <div className="native-settings-card__icon" aria-hidden="true"><Database size={20} /></div>
          <div>
            <h3 id="offline-mail-title">{t('settings.offlineMail.sectionTitle')}</h3>
            <p>{t('settings.offlineMail.hint')}</p>
          </div>
        </header>
        <label className="offline-mail-toggle" htmlFor="offline-mail-enabled">
          <input id="offline-mail-enabled" type="checkbox" checked={offlineMail.enabled} onChange={event => updateOfflineMail({ enabled: event.target.checked })} />
          <span>{t('settings.offlineMail.enabled')}</span>
        </label>
        <div className="native-settings-grid">
          <label className="native-settings-field" htmlFor="offline-mail-thread-limit">
            <span>{t('settings.offlineMail.threadLimit')}</span>
            <select id="offline-mail-thread-limit" disabled={!offlineMail.enabled} value={offlineMail.maxThreads} onChange={event => updateOfflineMail({ maxThreads: Number(event.target.value) })}>
              {[50, 100, 250, 500].map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="native-settings-field" htmlFor="offline-mail-age-limit">
            <span>{t('settings.offlineMail.ageLimit')}</span>
            <select id="offline-mail-age-limit" disabled={!offlineMail.enabled} value={offlineMail.maxAgeDays} onChange={event => updateOfflineMail({ maxAgeDays: Number(event.target.value) })}>
              {[7, 30, 90, 180].map(value => <option key={value} value={value}>{t('settings.offlineMail.days', { count: value })}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="native-settings-card preferences-card">
        <header className="native-settings-card__header"><div className="native-settings-card__icon" aria-hidden="true"><Lock size={20} /></div><div><h3>{t('settings.vault.sectionTitle')}</h3><p>{t('settings.vault.hint')}</p></div></header>
        {biometricAvailable ? <>
          <div className="native-settings-actions">
            <button className={biometricEnabled ? 'btn-ghost' : 'btn-primary'} type="button" disabled={biometricBusy} onClick={() => void toggleBiometrics()}>
              <Fingerprint size={16} />
              {t(biometricEnabled ? 'settings.vault.disableBiometrics' : 'settings.vault.enableBiometrics')}
            </button>
            <button className="btn-ghost" type="button" onClick={lock}>
              <Lock size={16} /> {t('settings.vault.lockNow')}
            </button>
          </div>
          {biometricDiagnostic && <div className="config-security-diagnostic" role="alert">
            <p>{t('settings.vault.biometricError')}</p>
            <pre>{biometricDiagnostic}</pre>
            <button className="btn-ghost" type="button" onClick={() => void copyBiometricDiagnostic()}>
              {diagnosticCopied ? <Check size={15} /> : <Copy size={15} />}
              {t(diagnosticCopied ? 'settings.vault.diagnosticCopied' : 'settings.vault.copyDiagnostic')}
            </button>
          </div>}
        </> : <>
          <p className="config-setting-help">{t('settings.vault.biometricUnavailable')}</p>
          <button className="btn-ghost" type="button" onClick={lock}><Lock size={16} /> {t('settings.vault.lockNow')}</button>
        </>}
      </section>

      </>}
      {section === 'about' && <section className="native-settings-card"><header className="native-settings-card__header"><div className="native-settings-card__icon" aria-hidden="true"><Info size={20} /></div><div><h3>{t('settings.navigation.about.title')}</h3></div></header><div className="preferences-build-info">
        <span>{t('settings.buildInfo.date')}: {formattedBuildDate}</span>
        <span>{t('settings.buildInfo.commit')}: <code>{buildCommitId}</code></span>
      </div></section>}

    </div>
  );
}
