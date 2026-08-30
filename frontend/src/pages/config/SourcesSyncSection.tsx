import { useEffect, useState } from 'react';
import { Check, CloudDownload, CloudUpload, Copy, Mail, QrCode } from 'lucide-react';
import QRCode from 'qrcode';
import { useTranslation } from 'react-i18next';

import { ConfigSyncConflictError } from '../../shared/api/configSyncApi';
import { useVault } from '../../shared/security/VaultProvider';
import { useLogoDevToken } from '../../shared/store/LogoDevTokenStore';

export function SourcesSyncSection() {
  const { t } = useTranslation();
  const { token: logoDevToken, setToken: setLogoDevToken } = useLogoDevToken();
  const {
    backupToNextcloud, configSyncSettings, configSyncStatus, configSyncInvitation, configSyncSummary,
    disableConfigSync, resolveConfigSyncConflict,
  } = useVault();
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
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

  const backup = () => {
    setStatus('busy');
    void backupToNextcloud({ serverUrl, username, password, recoveryKey: recoveryKey || undefined })
      .then(() => setStatus('done'))
      .catch(error => {
        console.error('[ConfigSync] backup failed', error);
        setStatus(error instanceof ConfigSyncConflictError ? 'idle' : 'error');
      });
  };

  const useNextcloudVersion = () => {
    setStatus('busy');
    void resolveConfigSyncConflict('remote')
      .then(() => setStatus('done'))
      .catch(error => {
        console.error('[ConfigSync] remote restore failed', error);
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
          <label className="native-settings-field" htmlFor="config-sync-recovery"><span>{t('vault.recoveryKey')}</span><input className="config-sync-recovery-key" id="config-sync-recovery" autoComplete="off" placeholder={t('settings.configSync.generatedAutomatically')} value={recoveryKey} onChange={event => setRecoveryKey(event.target.value)} /></label>
        </div>
        <div className="native-settings-actions config-sync-actions">
          <button className="btn-primary" type="button" disabled={status === 'busy' || !serverUrl || !username || !password} onClick={backup}><CloudUpload size={16} /> {t(status === 'busy' ? 'settings.configSync.working' : 'settings.configSync.backup')}</button>
          {status === 'done' && <span className="native-settings-status native-settings-status--success" role="status"><Check size={15} />{t('settings.configSync.done')}</span>}
          {status === 'error' && <span className="native-settings-status native-settings-status--error" role="alert">{t('settings.configSync.error')}</span>}
        </div>
        {configSyncSummary && <p className="config-sync-summary" role="status">
          {t(configSyncSummary.direction === 'uploaded' ? 'settings.configSync.uploadedSummary' : 'settings.configSync.downloadedSummary', {
            revision: configSyncSummary.revision,
            google: configSyncSummary.contents.googleSources,
            exchange: configSyncSummary.contents.exchangeSources,
            imap: configSyncSummary.contents.imapSources,
            jmap: configSyncSummary.contents.jmapSources,
          })}
        </p>}
        {configSyncStatus === 'conflict' && <div className="config-sync-alert" role="alert"><p>{t('settings.configSync.conflict')}</p><div className="native-settings-actions"><button className="btn-primary" type="button" onClick={() => void resolveConfigSyncConflict('local')}>{t('settings.configSync.keepLocal')}</button><button className="btn-ghost" type="button" disabled={status === 'busy'} onClick={useNextcloudVersion}>{t('settings.configSync.keepRemote')}</button></div></div>}
        {configSyncSettings && <div className="config-sync-sharing">
          {qrDataUrl && <figure className="config-sync-qr"><div className="config-sync-qr__title"><QrCode size={18} />{t('settings.configSync.scanHint')}</div><img src={qrDataUrl} width={220} height={220} alt={t('settings.configSync.qrAlt')} /></figure>}
          <div className="native-settings-actions">
            {configSyncStatus !== 'conflict' && <button className="btn-ghost" type="button" disabled={status === 'busy'} onClick={useNextcloudVersion}><CloudDownload size={15} />{t('settings.configSync.keepRemote')}</button>}
            <button className="btn-ghost" type="button" onClick={() => void navigator.clipboard.writeText(configSyncInvitation ?? '')}><Copy size={15} />{t('settings.configSync.copyInvitation')}</button>
            <button className="btn-ghost" type="button" onClick={disableConfigSync}>{t('settings.configSync.disable')}</button>
          </div>
        </div>}
      </section>

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
    </div>
  );
}
