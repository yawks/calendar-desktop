import { useEffect, useState } from 'react';
import { Check, CloudDownload, CloudUpload, Copy, Mail, QrCode } from 'lucide-react';
import QRCode from 'qrcode';
import { useTranslation } from 'react-i18next';

import { ConfigSyncConflictError, type NextcloudConfigLocation } from '../../shared/api/configSyncApi';
import { useVault } from '../../shared/security/VaultProvider';
import { useLogoDevToken } from '../../shared/store/LogoDevTokenStore';

export function SourcesSyncSection() {
  const { t } = useTranslation();
  const {
    backupToNextcloud, restoreFromNextcloud, configSyncSettings, configSyncStatus, configSyncInvitation, configSyncSummary,
    disableConfigSync, resolveConfigSyncConflict,
  } = useVault();
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [validationError, setValidationError] = useState('');
  const [pendingRestore, setPendingRestore] = useState<NextcloudConfigLocation | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    if (!configSyncSettings) return;
    setServerUrl(configSyncSettings.serverUrl);
    setUsername(configSyncSettings.username);
    setPassword(configSyncSettings.password);
    setRecoveryKey(configSyncSettings.recoveryKey ?? '');
  }, [configSyncSettings]);

  useEffect(() => {
    if (!configSyncInvitation) { setQrDataUrl(''); return; }
    void QRCode.toDataURL(configSyncInvitation, { width: 260, margin: 2, errorCorrectionLevel: 'M' }).then(setQrDataUrl);
  }, [configSyncInvitation]);

  const validate = (restoring: boolean) => {
    setValidationError('');
    setStatus('idle');
    if (!serverUrl.trim() || !username.trim() || !password) {
      setValidationError('settings.configSync.credentialsRequired');
      return false;
    }
    try {
      const url = new URL(serverUrl);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    } catch {
      setValidationError('settings.configSync.httpsRequired');
      return false;
    }
    if (restoring && !recoveryKey.trim()) {
      setValidationError('settings.configSync.recoveryRequired');
      return false;
    }
    return true;
  };

  const backup = () => {
    if (!validate(false)) return;
    setStatus('busy');
    void backupToNextcloud({ serverUrl, username, password, recoveryKey: recoveryKey || undefined })
      .then(() => setStatus('done'))
      .catch(error => {
        setStatus(error instanceof ConfigSyncConflictError ? 'idle' : 'error');
      });
  };

  const useNextcloudVersion = () => {
    if (!validate(true)) return;
    setPendingRestore({ serverUrl: serverUrl.trim(), username: username.trim(), password, recoveryKey: recoveryKey.trim() });
  };

  const confirmRestore = () => {
    if (!pendingRestore) return;
    const location = pendingRestore;
    setPendingRestore(null);
    setStatus('busy');
    void restoreFromNextcloud(location)
      .then(() => setStatus('done'))
      .catch(() => {
        setStatus('error');
      });
  };

  return (
    <div className="sources-sync-section">
      <section className="native-settings-card config-sync-card">
        <header className="native-settings-card__header">
          <div className="native-settings-card__icon" aria-hidden="true"><CloudUpload size={20} /></div>
          <div><h3>{t('settings.configSync.sectionTitle')}</h3><p>{t('settings.configSync.hint')}</p></div>
        </header>
        <div className="native-settings-grid">
          <label className="native-settings-field" htmlFor="config-sync-url"><span>{t('vault.nextcloudUrl')}</span><input id="config-sync-url" type="url" autoComplete="url" placeholder="https://cloud.example.com" value={serverUrl} onChange={event => setServerUrl(event.target.value)} /></label>
          <label className="native-settings-field" htmlFor="config-sync-user"><span>{t('vault.nextcloudUsername')}</span><input id="config-sync-user" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} /></label>
          <label className="native-settings-field" htmlFor="config-sync-password"><span>{t('vault.nextcloudPassword')}</span><input id="config-sync-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
          <label className="native-settings-field" htmlFor="config-sync-recovery"><span>{t('vault.recoveryKey')}</span><input type="password" className="config-sync-recovery-key" id="config-sync-recovery" autoComplete="off" aria-describedby="config-sync-recovery-help" value={recoveryKey} onChange={event => setRecoveryKey(event.target.value)} /></label>
        </div>
        <p id="config-sync-recovery-help" className="config-sync-help">{t('settings.configSync.recoveryHelp')}</p>
        <p className="config-sync-help">{t('settings.configSync.urlHelp')}</p>
        <div className="native-settings-actions config-sync-actions">
          <button className="btn-primary" type="button" disabled={status === 'busy' || pendingRestore !== null} onClick={backup}><CloudUpload size={16} /> {t(status === 'busy' ? 'settings.configSync.working' : 'settings.configSync.backup')}</button>
          <button className="btn-ghost" type="button" disabled={status === 'busy' || pendingRestore !== null} onClick={useNextcloudVersion}><CloudDownload size={16} /> {t('settings.configSync.restore')}</button>
          {status === 'busy' && <span className="native-settings-status" role="status">{t('settings.configSync.working')}</span>}
          {validationError && <span className="native-settings-status native-settings-status--error" role="alert">{t(validationError)}</span>}
          {status === 'done' && !configSyncSummary && <span className="native-settings-status native-settings-status--success" role="status"><Check size={15} />{t('settings.configSync.finished')}</span>}
          {status === 'error' && <span className="native-settings-status native-settings-status--error" role="alert">{t('settings.configSync.operationError')}</span>}
        </div>
        {pendingRestore && <div className="config-sync-alert" role="alert">
          <p>{t('settings.configSync.restoreConfirm')}</p>
          <div className="native-settings-actions">
            <button className="btn-primary" type="button" onClick={confirmRestore}>{t('settings.configSync.confirmRestore')}</button>
            <button className="btn-ghost" type="button" onClick={() => setPendingRestore(null)}>{t('config.cancel')}</button>
          </div>
        </div>}
        {configSyncSummary && <p className="config-sync-summary" role="status">
          {t(configSyncSummary.direction === 'uploaded' ? 'settings.configSync.uploadedSummary' : 'settings.configSync.downloadedSummary', {
            revision: configSyncSummary.revision,
            google: configSyncSummary.contents.googleSources,
            exchange: configSyncSummary.contents.exchangeSources,
            imap: configSyncSummary.contents.imapSources,
            jmap: configSyncSummary.contents.jmapSources,
          })}
        </p>}
        {configSyncStatus === 'conflict' && <div className="config-sync-alert" role="alert"><p>{t('settings.configSync.conflict')}</p><div className="native-settings-actions"><button className="btn-primary" type="button" onClick={() => void resolveConfigSyncConflict('local')}>{t('settings.configSync.keepLocal')}</button><button className="btn-ghost" type="button" disabled={status === 'busy' || pendingRestore !== null} onClick={useNextcloudVersion}>{t('settings.configSync.keepRemote')}</button></div></div>}
        {configSyncSettings && <div className="config-sync-sharing">
          {qrDataUrl && <figure className="config-sync-qr"><div className="config-sync-qr__title"><QrCode size={18} />{t('settings.configSync.scanHint')}</div><img src={qrDataUrl} width={220} height={220} alt={t('settings.configSync.qrAlt')} /></figure>}
          <div className="native-settings-actions">
            <button className="btn-ghost" type="button" onClick={() => void navigator.clipboard.writeText(configSyncSettings.recoveryKey ?? '')}><Copy size={15} />{t('settings.configSync.copyRecoveryKey')}</button>
            <button className="btn-ghost" type="button" onClick={() => void navigator.clipboard.writeText(configSyncInvitation ?? '')}><Copy size={15} />{t('settings.configSync.copyInvitation')}</button>
            <button className="btn-ghost" type="button" onClick={disableConfigSync}>{t('settings.configSync.disable')}</button>
          </div>
        </div>}
      </section>


    </div>
  );
}

export function ContactLogosSection() {
  const { t } = useTranslation();
  const { token: logoDevToken, setToken: setLogoDevToken } = useLogoDevToken();
  return (
      <section className="native-settings-card sources-logo-card">
        <header className="native-settings-card__header">
          <div className="native-settings-card__icon" aria-hidden="true"><Mail size={20} /></div>
          <div><h3>{t('settings.logoDev.sectionTitle', 'Logos des contacts')}</h3><p>{t('settings.logoDev.hint', "Token logo.dev pour afficher les logos d'entreprise dans les avatars.")}</p></div>
        </header>
        <label className="native-settings-field" htmlFor="logo-dev-token">
          <span>{t('settings.logoDev.token', 'Token Logo.dev')}</span>
          <input id="logo-dev-token" type="password" value={logoDevToken} onChange={event => setLogoDevToken(event.target.value)} placeholder="pk_..." />
        </label>
      </section>
  );
}
