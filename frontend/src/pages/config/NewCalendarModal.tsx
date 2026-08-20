import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, Mail, Rss, X } from 'lucide-react';
import { useCalendars } from '../../features/calendar/store/CalendarStore';
import { useGoogleAuth } from '../../shared/store/GoogleAuthStore';
import { useExchangeAuth, parseExchangeToken } from '../../shared/store/ExchangeAuthStore';
import { useImapAuth } from '../../shared/store/ImapAuthStore';
import { useJmapAuth } from '../../shared/store/JmapAuthStore';
import { ExchangeAccount } from '../../shared/types';
import { openExternalUrl } from '../../shared/services/fileService';
import { exchangeAuthApi } from '../../shared/api/exchangeAuthApi';
import { usesNativeGoogleAuth } from '../../shared/api/nativeGoogleAuth';
import { CapBadge, ColorSwatches, ConnectionTestRow, DEFAULT_COLORS, TestResult, nextColor, testNextcloudConnection } from './ConfigShared';

export function NewCalendarModal({
  onClose, initialProvider,
}: {
  onClose: () => void;
  initialProvider?: 'exchange' | 'google' | 'imap' | 'jmap';
}) {
  const { t } = useTranslation();
  const { addCalendar, calendars } = useCalendars();
  const { connectGoogle, updateAccountCapabilities: updateGoogleCapabilities } = useGoogleAuth();
  const { addAccount } = useExchangeAuth();
  const { addAccount: addImapAccount } = useImapAuth();
  const { addAccount: addJmapAccount } = useJmapAuth();

  const [step, setStep] = useState<'pick' | 'capabilities' | 'configure' | 'google' | 'exchange' | 'imap' | 'jmap'>(() => initialProvider ?? 'pick');
  const [selectedType, setSelectedType] = useState<'ics' | 'nextcloud' | null>(null);
  const [pendingProviderType, setPendingProviderType] = useState<'google' | 'exchange' | null>(() => initialProvider === 'google' || initialProvider === 'exchange' ? initialProvider : null);
  const [pendingCapabilities, setPendingCapabilities] = useState<('calendar' | 'email')[]>(['calendar', 'email']);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');
  const [googleServerConfigured, setGoogleServerConfigured] = useState<boolean | null>(null);
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');

  useEffect(() => {
    if (usesNativeGoogleAuth()) {
      setGoogleServerConfigured(false);
      return;
    }
    fetch('/auth/google/configuration')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { configured: boolean }) => setGoogleServerConfigured(data.configured))
      .catch(() => setGoogleServerConfigured(false));
  }, []);

  // Exchange device code flow state
  const [exUserCode, setExUserCode] = useState('');
  const [exVerifUri, setExVerifUri] = useState('');
  const [exDeviceCode, setExDeviceCode] = useState('');
  const [exInterval, setExInterval] = useState(5);
  const [exPolling, setExPolling] = useState(false);
  const [exCalName, setExCalName] = useState('Exchange Calendar');
  const [exColor, setExColor] = useState('#0078d4');

  // ICS form
  const [icsName, setIcsName] = useState('');
  const [icsUrl, setIcsUrl] = useState('');
  const [icsEmail, setIcsEmail] = useState('');
  const [icsColor, setIcsColor] = useState(() => nextColor(calendars));

  // Nextcloud form
  const [ncName, setNcName] = useState('');
  const [ncServerUrl, setNcServerUrl] = useState('');
  const [ncCalendarUrl, setNcCalendarUrl] = useState('');
  const [ncUsername, setNcUsername] = useState('');
  const [ncPassword, setNcPassword] = useState('');
  const [ncColor, setNcColor] = useState(() => nextColor(calendars));
  const [ncTestResult, setNcTestResult] = useState<TestResult | null>(null);
  const [ncTesting, setNcTesting] = useState(false);

  // IMAP form
  const [imapEmail, setImapEmail] = useState('');
  const [imapDisplayName, setImapDisplayName] = useState('');
  const [imapServer, setImapServer] = useState('');
  const [imapPort, setImapPort] = useState(993);
  const [imapUseSsl, setImapUseSsl] = useState(true);
  const [imapUseStarttls, setImapUseStarttls] = useState(false);
  const [imapUsername, setImapUsername] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [smtpServer, setSmtpServer] = useState('');
  const [smtpPort, setSmtpPort] = useState(465);
  const [smtpUseSsl, setSmtpUseSsl] = useState(true);
  const [smtpUseStarttls, setSmtpUseStarttls] = useState(false);
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [imapColor, setImapColor] = useState(() => nextColor(calendars));

  // JMAP form
  const [jmapEmail, setJmapEmail] = useState('');
  const [jmapDisplayName, setJmapDisplayName] = useState('');
  const [jmapSessionUrl, setJmapSessionUrl] = useState('https://api.fastmail.com/jmap/session');
  const [jmapToken, setJmapToken] = useState('');
  const [jmapAuthType, setJmapAuthType] = useState<'bearer' | 'basic'>('bearer');
  const [jmapColor, setJmapColor] = useState(() => nextColor(calendars));
  const [jmapFastmailToken, setJmapFastmailToken] = useState('');
  const [jmapFastmailCookie, setJmapFastmailCookie] = useState('');
  const [jmapAdvancedOpen, setJmapAdvancedOpen] = useState(false);

  const handleNcTest = async () => {
    setNcTesting(true);
    setNcTestResult(null);
    const result = await testNextcloudConnection(ncCalendarUrl, ncUsername, ncPassword);
    setNcTestResult(result);
    setNcTesting(false);
  };

  const resetNcTest = () => setNcTestResult(null);

  const handleConnectGoogle = async () => {
    setConnecting(true);
    setConnectError('');
    try {
      const credentials = googleServerConfigured
        ? undefined
        : { clientId: googleClientId.trim(), clientSecret: googleClientSecret.trim() };
      const account = await connectGoogle(pendingCapabilities, credentials);
      if (account) {
        updateGoogleCapabilities(account.id, pendingCapabilities);
        onClose();
      } else {
        setConnectError(t('config.googleConnectionError'));
      }
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : String(error));
    } finally {
      setConnecting(false);
    }
  };

  const handleTypeSelect = (type: 'ics' | 'google' | 'nextcloud' | 'exchange' | 'imap' | 'jmap') => {
    if (type === 'google' || type === 'exchange') {
      setPendingProviderType(type);
      setPendingCapabilities(['calendar', 'email']);
      setStep('capabilities');
      return;
    }
    if (type === 'imap') { setStep('imap'); return; }
    if (type === 'jmap') { setStep('jmap'); return; }
    setSelectedType(type);
    setStep('configure');
  };

  const handleCapabilitiesContinue = () => {
    if (pendingProviderType === 'google') setStep('google');
    else if (pendingProviderType === 'exchange') setStep('exchange');
  };

  const startExchangeAuth = async () => {
    setConnecting(true);
    setConnectError('');
    try {
      const res = await exchangeAuthApi.startDeviceAuth();
      setExDeviceCode(res.device_code);
      setExUserCode(res.user_code);
      setExVerifUri(res.verification_uri);
      setExInterval(res.interval);
      setExPolling(true);
      openExternalUrl(res.verification_uri);
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : t('config.exchangeAuthError'));
    } finally {
      setConnecting(false);
    }
  };

  useEffect(() => {
    if (!exPolling || !exDeviceCode) return;
    const timer = setInterval(async () => {
      try {
        const res = await exchangeAuthApi.pollDeviceToken(exDeviceCode);
        clearInterval(timer);
        setExPolling(false);
        const { email, displayName } = parseExchangeToken(res.access_token);
        const account: ExchangeAccount = {
          id: email,
          email,
          displayName,
          accessToken: res.access_token,
          refreshToken: res.refresh_token ?? '',
          expiresAt: Date.now() + res.expires_in * 1000,
          enabledCapabilities: pendingCapabilities,
        };
        addAccount(account);
        if (pendingCapabilities.includes('calendar')) {
          addCalendar({
            name: exCalName.trim() || 'Exchange Calendar',
            url: '',
            color: exColor,
            visible: true,
            type: 'exchange',
            ownerEmail: email,
            exchangeAccountId: email,
          });
        }
        onClose();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'authorization_pending' || msg.includes('authorization_pending')) return;
        clearInterval(timer);
        setExPolling(false);
        setConnectError(msg);
      }
    }, exInterval * 1000);
    return () => clearInterval(timer);
  }, [exPolling, exDeviceCode, exInterval, exCalName, exColor, pendingCapabilities, addAccount, addCalendar, onClose, t]);

  const handleAddICS = (e: FormEvent) => {
    e.preventDefault();
    if (!icsName.trim() || !icsUrl.trim()) return;
    addCalendar({ name: icsName.trim(), url: icsUrl.trim(), color: icsColor, visible: true, ownerEmail: icsEmail.trim() || undefined, type: 'ics' });
    onClose();
  };

  const handleAddNextcloud = (e: FormEvent) => {
    e.preventDefault();
    if (!ncName.trim() || !ncCalendarUrl.trim()) return;
    addCalendar({
      name: ncName.trim(), url: ncCalendarUrl.trim(), color: ncColor, visible: true,
      type: 'nextcloud',
      nextcloudServerUrl: ncServerUrl.trim() || undefined,
      nextcloudUsername: ncUsername.trim() || undefined,
      nextcloudPassword: ncPassword || undefined,
    });
    onClose();
  };

  const handleAddImap = (e: FormEvent) => {
    e.preventDefault();
    if (!imapEmail.trim() || !imapServer.trim() || !smtpServer.trim()) return;
    addImapAccount({
      id: imapEmail.trim(),
      email: imapEmail.trim(),
      displayName: imapDisplayName.trim() || imapEmail.trim(),
      imapServer: imapServer.trim(),
      imapPort,
      imapUseSsl,
      imapUseStarttls,
      imapUsername: imapUsername.trim(),
      imapPassword,
      smtpServer: smtpServer.trim(),
      smtpPort,
      smtpUseSsl,
      smtpUseStarttls,
      smtpUsername: smtpUsername.trim(),
      smtpPassword,
      color: imapColor,
    });
    onClose();
  };

  const handleAddJmap = (e: FormEvent) => {
    e.preventDefault();
    if (!jmapEmail.trim() || !jmapSessionUrl.trim() || !jmapToken.trim()) return;
    addJmapAccount({
      id: jmapEmail.trim(),
      email: jmapEmail.trim(),
      displayName: jmapDisplayName.trim() || jmapEmail.trim(),
      sessionUrl: jmapSessionUrl.trim(),
      token: jmapToken.trim(),
      authType: jmapAuthType,
      color: jmapColor,
      fastmailToken: jmapFastmailToken.trim() || undefined,
      fastmailCookie: jmapFastmailCookie.trim() || undefined,
    });
    onClose();
  };

  const typeCards: { type: 'ics' | 'google' | 'nextcloud' | 'exchange' | 'imap' | 'jmap'; icon: React.ReactNode; label: string; desc: string; caps: ('calendar' | 'email')[] }[] = [
    { type: 'ics', icon: <Rss size={28} />, label: 'ICS / iCal', desc: t('config.icsFluxDesc'), caps: ['calendar'] },
    {
      type: 'google',
      icon: (
        <svg width="28" height="28" viewBox="0 0 18 18" aria-hidden="true">
          <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
          <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
          <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" />
          <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z" />
        </svg>
      ),
      label: t('config.googleAgenda'), desc: t('config.googleDesc'), caps: ['calendar', 'email'],
    },
    { type: 'nextcloud', icon: <Cloud size={28} />, label: 'Nextcloud', desc: t('config.nextcloudCalDAV'), caps: ['calendar'] },
    {
      type: 'exchange',
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect width="24" height="24" rx="4" fill="#0078d4" />
          <text x="12" y="17" textAnchor="middle" fontSize="13" fontWeight="bold" fill="white" fontFamily="sans-serif">Ex</text>
        </svg>
      ),
      label: 'Exchange / Office 365', desc: t('config.exchangeDesc'), caps: ['calendar', 'email'],
    },
    { type: 'imap', icon: <Mail size={28} />, label: 'IMAP / SMTP', desc: t('config.imapDesc', 'Generic IMAP/SMTP account'), caps: ['email'] },
    { type: 'jmap', icon: <Mail size={28} />, label: 'JMAP', desc: t('config.jmapDesc', 'JMAP account (Fastmail, Stalwart, ...)'), caps: ['email'] },
  ];

  const modalTitle = step === 'pick'
    ? t('config.connectProvider')
    : step === 'capabilities' ? t('config.chooseServices')
    : step === 'google' ? t('config.googleAgenda')
    : step === 'exchange' ? 'Exchange / Office 365'
    : step === 'imap' ? 'IMAP / SMTP'
    : step === 'jmap' ? 'JMAP'
    : selectedType === 'ics' ? t('config.addICSCalendar')
    : t('config.addNextcloudCalendar');

  return (
    <div className="nc-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`nc-modal-box ${step === 'pick' ? 'nc-modal-box--narrow' : 'nc-modal-box--wide'}`}>
        <div className="nc-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {step !== 'pick' && !exPolling && (
              <button
                type="button"
                className="nc-modal-back"
                onClick={() => {
                  if (step === 'capabilities') { setStep('pick'); setPendingProviderType(null); return; }
                  if (step === 'google' || step === 'exchange') { setStep('capabilities'); setConnectError(''); return; }
                  setStep('pick'); setSelectedType(null); setConnectError(''); setExUserCode(''); setExDeviceCode(''); setExPolling(false);
                }}
                title={t('config.back')}
              >
                ←
              </button>
            )}
            <h2>{modalTitle}</h2>
          </div>
          <button type="button" className="nc-modal-close" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="nc-modal-body">
          {/* Step 1: pick type */}
          {step === 'pick' && (
            <>
              <p style={{ margin: '0 0 20px', fontSize: 'calc(14px * var(--font-scale, 1))', color: 'var(--text-muted)' }}>
                {t('config.chooseProviderType')}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {typeCards.map(({ type, icon, label, desc, caps }) => (
                  <button key={type} type="button" className="calendar-type-card" onClick={() => handleTypeSelect(type)}>
                    <span className="calendar-type-card-icon">{icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="calendar-type-card-label">{label}</div>
                      <div className="calendar-type-card-desc">{desc}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      {caps.map((cap) => <CapBadge key={cap} cap={cap} />)}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Step: capabilities selection */}
          {step === 'capabilities' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ margin: 0, fontSize: 'calc(14px * var(--font-scale, 1))', color: 'var(--text-muted)' }}>
                {t('config.chooseServicesDesc')}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(['calendar', 'email'] as const).map((cap) => (
                  <label key={cap} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                    <input
                      type="checkbox"
                      checked={pendingCapabilities.includes(cap)}
                      onChange={(e) => {
                        if (e.target.checked) setPendingCapabilities((prev) => [...prev, cap]);
                        else setPendingCapabilities((prev) => prev.filter((c) => c !== cap));
                      }}
                    />
                    <CapBadge cap={cap} />
                    <span style={{ fontSize: 'calc(14px * var(--font-scale, 1))' }}>{t(`config.cap.${cap}`)}</span>
                  </label>
                ))}
              </div>
              <button type="button" className="btn-primary" onClick={handleCapabilitiesContinue} disabled={pendingCapabilities.length === 0} style={{ width: '100%', justifyContent: 'center' }}>
                {t('config.continue')}
              </button>
            </div>
          )}

          {/* Step: Google */}
          {step === 'google' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ margin: 0, fontSize: 'calc(13px * var(--font-scale, 1))', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {googleServerConfigured ? t('config.oauthServerConfigured') : t(usesNativeGoogleAuth() ? 'config.oauthNativeDescription' : 'config.oauthDescription')}
              </p>
              {googleServerConfigured === false && (
                <>
                  <div className="form-row">
                    <label htmlFor="google-client-id">{t('config.googleClientId')}</label>
                    <input id="google-client-id" type="text" value={googleClientId} onChange={(e) => setGoogleClientId(e.target.value)} required autoComplete="off" />
                  </div>
                  <div className="form-row">
                    <label htmlFor="google-client-secret">{t('config.googleClientSecret')}</label>
                    <input id="google-client-secret" type="password" value={googleClientSecret} onChange={(e) => setGoogleClientSecret(e.target.value)} required autoComplete="off" />
                  </div>
                </>
              )}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <button type="button" className="btn-primary" onClick={handleConnectGoogle} disabled={connecting || googleServerConfigured === null || (!googleServerConfigured && (!googleClientId.trim() || !googleClientSecret.trim()))} style={{ width: '100%', justifyContent: 'center' }}>
                  {connecting ? t('config.connectingGoogle') : t('config.connectGoogleAccount')}
                </button>
                {connectError && <div style={{ marginTop: 10, fontSize: 'calc(13px * var(--font-scale, 1))', color: 'var(--color-error, #d93025)' }}>{connectError}</div>}
              </div>
            </div>
          )}

          {/* Step: Exchange device code flow */}
          {step === 'exchange' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-row">
                <label htmlFor="exchange-cal-name">{t('config.nameLabel')}</label>
                <input id="exchange-cal-name" type="text" value={exCalName} onChange={(e) => setExCalName(e.target.value)} placeholder="Exchange Calendar" />
              </div>
              <div className="form-row">
                <label htmlFor="exchange-cal-color">{t('config.colorLabel')}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <ColorSwatches colors={DEFAULT_COLORS} selected={exColor} onSelect={setExColor} />
                  <input id="exchange-cal-color" type="color" value={exColor} onChange={(e) => setExColor(e.target.value)} />
                </div>
              </div>
              {!exUserCode && !exPolling && (
                <button type="button" className="btn-primary" onClick={startExchangeAuth} disabled={connecting} style={{ width: '100%', justifyContent: 'center' }}>
                  {connecting ? t('config.connecting') : t('config.exchangeStartAuth')}
                </button>
              )}
              {exUserCode && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <p style={{ margin: 0, fontSize: 'calc(14px * var(--font-scale, 1))' }}>{t('config.exchangeEnterCode')}</p>
                  <div style={{ fontSize: 'calc(28px * var(--font-scale, 1))', fontWeight: 700, letterSpacing: 4, textAlign: 'center', padding: '12px 20px', background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8, border: '1px solid var(--border)', fontFamily: 'monospace' }}>
                    {exUserCode}
                  </div>
                  <button type="button" className="btn-edit" onClick={() => openExternalUrl(exVerifUri)} style={{ fontSize: 'calc(13px * var(--font-scale, 1))' }}>
                    {t('config.exchangeOpenBrowser')} ↗
                  </button>
                  {exPolling && <p style={{ margin: 0, fontSize: 'calc(13px * var(--font-scale, 1))', color: 'var(--text-muted)', textAlign: 'center' }}>{t('config.exchangeWaiting')}</p>}
                </div>
              )}
              {connectError && <div style={{ fontSize: 'calc(13px * var(--font-scale, 1))', color: 'var(--color-error, #d93025)' }}>{connectError}</div>}
            </div>
          )}

          {/* Step: JMAP form */}
          {step === 'jmap' && (
            <form onSubmit={handleAddJmap} className="config-form">
              <div className="config-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div>
                  <h3 style={{ fontSize: 'calc(14px * var(--font-scale, 1))', marginBottom: 12 }}>{t('config.generalInfo', 'General')}</h3>
                  <div className="form-row">
                    <label>{t('config.email', 'Email')}</label>
                    <input type="email" value={jmapEmail} onChange={(e) => setJmapEmail(e.target.value)} required />
                  </div>
                  <div className="form-row">
                    <label>{t('config.displayName', 'Display Name')}</label>
                    <input type="text" value={jmapDisplayName} onChange={(e) => setJmapDisplayName(e.target.value)} />
                  </div>
                </div>
                <div>
                  <h3 style={{ fontSize: 'calc(14px * var(--font-scale, 1))', marginBottom: 12 }}>{t('config.accountColor', 'Color')}</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <ColorSwatches colors={DEFAULT_COLORS} selected={jmapColor} onSelect={setJmapColor} />
                    <input type="color" value={jmapColor} onChange={(e) => setJmapColor(e.target.value)} />
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 20 }}>
                <h3 style={{ fontSize: 'calc(14px * var(--font-scale, 1))', marginBottom: 12 }}>{t('config.jmapConfiguration')}</h3>
                <div className="form-row">
                  <label>{t('config.sessionUrl')}</label>
                  <input type="text" value={jmapSessionUrl} onChange={(e) => setJmapSessionUrl(e.target.value)} placeholder="https://api.fastmail.com/jmap/session" required />
                </div>
                <div className="form-row">
                  <label>{t('config.jmapAuthType', 'Auth type')}</label>
                  <select value={jmapAuthType} onChange={(e) => setJmapAuthType(e.target.value as 'bearer' | 'basic')}>
                    <option value="bearer">{t('config.jmapAuthBearer', 'Bearer token')}</option>
                    <option value="basic">{t('config.jmapAuthBasic', 'Basic (email + app password)')}</option>
                  </select>
                </div>
                <div className="form-row">
                  <label>{jmapAuthType === 'basic' ? t('config.jmapAppPassword', 'App password') : t('config.jmapApiToken', 'API token')}</label>
                  <input type="password" value={jmapToken} onChange={(e) => setJmapToken(e.target.value)} required />
                </div>
                <div className="jmap-advanced">
                  <button type="button" className="jmap-advanced__toggle" onClick={() => setJmapAdvancedOpen(value => !value)}>
                    {t('config.advanced', 'Avancé')}
                  </button>
                  {jmapAdvancedOpen && <div className="jmap-advanced__content form-row">
                    <label>{t('config.fastmailWebToken', 'Jeton web Fastmail')}</label>
                    <input type="password" autoComplete="off" value={jmapFastmailToken} onChange={(e) => setJmapFastmailToken(e.target.value)} placeholder="fma1-…" />
                    <small>{t('config.fastmailWebTokenHelp', 'Optionnel. Collez uniquement la valeur fma1…, sans le préfixe Bearer.')}</small>
                    <label>{t('config.fastmailCookie', 'Cookie Fastmail')}</label>
                    <textarea rows={3} value={jmapFastmailCookie} onChange={(e) => setJmapFastmailCookie(e.target.value)} placeholder="seenlogin=1; __Http-f_…; __Http-s_…" spellCheck={false} />
                    <small>{t('config.fastmailCookieHelp', 'Copiez la valeur complète passée à curl avec -b. Elle doit correspondre au jeton fma1.')}</small>
                  </div>}
                </div>
              </div>
              <div className="form-actions" style={{ marginTop: 24 }}>
                <button type="submit" className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>{t('config.add', 'Ajouter')}</button>
                <button type="button" className="btn-cancel" onClick={onClose}>{t('config.cancel', 'Annuler')}</button>
              </div>
            </form>
          )}

          {/* Step: IMAP form */}
          {step === 'imap' && (
            <form onSubmit={handleAddImap} className="config-form">
              <div className="config-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div>
                  <h3 style={{ fontSize: 'calc(14px * var(--font-scale, 1))', marginBottom: 12 }}>{t('config.generalInfo', 'General')}</h3>
                  <div className="form-row">
                    <label>{t('config.email', 'Email')}</label>
                    <input type="email" value={imapEmail} onChange={(e) => setImapEmail(e.target.value)} required />
                  </div>
                  <div className="form-row">
                    <label>{t('config.displayName', 'Display Name')}</label>
                    <input type="text" value={imapDisplayName} onChange={(e) => setImapDisplayName(e.target.value)} />
                  </div>
                </div>
                <div>
                  <h3 style={{ fontSize: 'calc(14px * var(--font-scale, 1))', marginBottom: 12 }}>{t('config.accountColor', 'Color')}</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <ColorSwatches colors={DEFAULT_COLORS} selected={imapColor} onSelect={setImapColor} />
                    <input type="color" value={imapColor} onChange={(e) => setImapColor(e.target.value)} />
                  </div>
                </div>
              </div>
              <div className="config-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 20 }}>
                <div>
                  <h3 style={{ fontSize: 'calc(14px * var(--font-scale, 1))', marginBottom: 12 }}>{t('config.imapIncoming')}</h3>
                  <div className="form-row">
                    <label>{t('config.server', 'Server')}</label>
                    <input type="text" value={imapServer} onChange={(e) => setImapServer(e.target.value)} required />
                  </div>
                  <div className="form-row">
                    <label>{t('config.port', 'Port')}</label>
                    <input type="number" value={imapPort} onChange={(e) => setImapPort(Number(e.target.value))} required />
                  </div>
                  <div className="form-row--inline" style={{ display: 'flex', gap: 15, margin: '8px 0' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 'calc(13px * var(--font-scale, 1))' }}>
                      <input type="checkbox" checked={imapUseSsl} onChange={(e) => { setImapUseSsl(e.target.checked); if (e.target.checked) setImapUseStarttls(false); }} />
                      SSL / TLS
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 'calc(13px * var(--font-scale, 1))' }}>
                      <input type="checkbox" checked={imapUseStarttls} onChange={(e) => { setImapUseStarttls(e.target.checked); if (e.target.checked) setImapUseSsl(false); }} />
                      STARTTLS
                    </label>
                  </div>
                  <div className="form-row">
                    <label>{t('config.username', 'Username')}</label>
                    <input type="text" value={imapUsername} onChange={(e) => setImapUsername(e.target.value)} required />
                  </div>
                  <div className="form-row">
                    <label>{t('config.password', 'Password')}</label>
                    <input type="password" value={imapPassword} onChange={(e) => setImapPassword(e.target.value)} required />
                  </div>
                </div>
                <div>
                  <h3 style={{ fontSize: 'calc(14px * var(--font-scale, 1))', marginBottom: 12 }}>{t('config.smtpOutgoing')}</h3>
                  <div className="form-row">
                    <label>{t('config.server', 'Server')}</label>
                    <input type="text" value={smtpServer} onChange={(e) => setSmtpServer(e.target.value)} required />
                  </div>
                  <div className="form-row">
                    <label>{t('config.port', 'Port')}</label>
                    <input type="number" value={smtpPort} onChange={(e) => setSmtpPort(Number(e.target.value))} required />
                  </div>
                  <div className="form-row--inline" style={{ display: 'flex', gap: 15, margin: '8px 0' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 'calc(13px * var(--font-scale, 1))' }}>
                      <input type="checkbox" checked={smtpUseSsl} onChange={(e) => { setSmtpUseSsl(e.target.checked); if (e.target.checked) setSmtpUseStarttls(false); }} />
                      SSL / TLS
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 'calc(13px * var(--font-scale, 1))' }}>
                      <input type="checkbox" checked={smtpUseStarttls} onChange={(e) => { setSmtpUseStarttls(e.target.checked); if (e.target.checked) setSmtpUseSsl(false); }} />
                      STARTTLS
                    </label>
                  </div>
                  <div className="form-row">
                    <label>{t('config.username', 'Username')}</label>
                    <input type="text" value={smtpUsername} onChange={(e) => setSmtpUsername(e.target.value)} required />
                  </div>
                  <div className="form-row">
                    <label>{t('config.password', 'Password')}</label>
                    <input type="password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} required />
                  </div>
                </div>
              </div>
              <div className="form-actions" style={{ marginTop: 24 }}>
                <button type="submit" className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>{t('config.add', 'Ajouter')}</button>
                <button type="button" className="btn-cancel" onClick={onClose}>{t('config.cancel', 'Annuler')}</button>
              </div>
            </form>
          )}

          {/* Step 2: ICS form */}
          {step === 'configure' && selectedType === 'ics' && (
            <form onSubmit={handleAddICS} className="config-form">
              <div className="form-row">
                <label htmlFor="modal-ics-name">{t('config.nameLabel')}</label>
                <input id="modal-ics-name" type="text" placeholder={t('config.icsCalendarNamePlaceholder')} value={icsName} onChange={(e) => setIcsName(e.target.value)} required autoFocus />
              </div>
              <div className="form-row">
                <label htmlFor="modal-ics-url">{t('config.icsUrl')}</label>
                <input id="modal-ics-url" type="url" placeholder="https://calendar.google.com/…/basic.ics" value={icsUrl} onChange={(e) => setIcsUrl(e.target.value)} required />
              </div>
              <div className="form-row">
                <label htmlFor="modal-ics-email">
                  {t('config.myEmail')}{' '}
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>{t('config.optional')}</span>
                </label>
                <input id="modal-ics-email" type="email" placeholder="moi@example.com" value={icsEmail} onChange={(e) => setIcsEmail(e.target.value)} />
              </div>
              <div className="form-row">
                <label htmlFor="modal-ics-color">{t('config.colorLabel')}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <ColorSwatches colors={DEFAULT_COLORS} selected={icsColor} onSelect={setIcsColor} />
                  <input id="modal-ics-color" type="color" value={icsColor} onChange={(e) => setIcsColor(e.target.value)} />
                </div>
              </div>
              <div className="form-actions" style={{ marginTop: 20 }}>
                <button type="submit" className="btn-primary" disabled={!icsName.trim() || !icsUrl.trim()}>{t('config.add')}</button>
                <button type="button" className="btn-cancel" onClick={onClose}>{t('config.cancel')}</button>
              </div>
            </form>
          )}

          {/* Step 2: Nextcloud form */}
          {step === 'configure' && selectedType === 'nextcloud' && (
            <form onSubmit={handleAddNextcloud} className="config-form">
              <div className="form-row">
                <label htmlFor="modal-nc-name">{t('config.displayedName')}</label>
                <input id="modal-nc-name" type="text" placeholder={t('config.personalCalendarPlaceholder')} value={ncName} onChange={(e) => setNcName(e.target.value)} required autoFocus />
              </div>
              <div className="form-row">
                <label htmlFor="modal-nc-server">{t('config.nextcloudServerUrl')}</label>
                <input id="modal-nc-server" type="url" placeholder="https://cloud.example.com" value={ncServerUrl} onChange={(e) => setNcServerUrl(e.target.value)} />
              </div>
              <div className="form-row">
                <label htmlFor="modal-nc-cal-url">{t('config.caldavCalendarUrl')}</label>
                <input id="modal-nc-cal-url" type="url" placeholder="https://cloud.example.com/remote.php/dav/calendars/user/personal/" value={ncCalendarUrl} onChange={(e) => { setNcCalendarUrl(e.target.value); resetNcTest(); }} required />
                <div style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: 'var(--text-muted)', marginTop: 4 }}>{t('config.caldavHelp')}</div>
              </div>
              <div className="form-row">
                <label htmlFor="modal-nc-user">{t('config.username')}</label>
                <input id="modal-nc-user" type="text" value={ncUsername} onChange={(e) => { setNcUsername(e.target.value); resetNcTest(); }} />
              </div>
              <div className="form-row">
                <label htmlFor="modal-nc-pass">{t('config.appPassword')}</label>
                <input id="modal-nc-pass" type="password" placeholder={t('config.appPasswordHelp')} value={ncPassword} onChange={(e) => { setNcPassword(e.target.value); resetNcTest(); }} />
              </div>
              <div className="form-row">
                <label htmlFor="modal-nc-color">{t('config.colorLabel')}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <ColorSwatches colors={DEFAULT_COLORS} selected={ncColor} onSelect={setNcColor} />
                  <input id="modal-nc-color" type="color" value={ncColor} onChange={(e) => setNcColor(e.target.value)} />
                </div>
              </div>
              <ConnectionTestRow result={ncTestResult} testing={ncTesting} onTest={handleNcTest} />
              <div className="form-actions" style={{ marginTop: 12 }}>
                <button type="submit" className="btn-primary" disabled={!ncName.trim() || !ncCalendarUrl.trim()}>{t('config.add')}</button>
                <button type="button" className="btn-cancel" onClick={onClose}>{t('config.cancel')}</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
