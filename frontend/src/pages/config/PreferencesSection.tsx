import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Check, Columns2, Copy, Fingerprint, Languages, LayoutPanelTop, Lock, Mail, Monitor, Moon, Sun, Type } from 'lucide-react';
import { useFontSize, FontSizePreference } from '../../shared/store/FontSizeStore';
import { useLanguage } from '../../shared/store/LanguageStore';
import { LanguagePreference } from '../../i18n';
import { useLayout, AppLayout } from '../../shared/store/LayoutStore';
import { useLogoDevToken } from '../../shared/store/LogoDevTokenStore';
import { useTheme, ThemePreference } from '../../shared/store/ThemeStore';
import { useVault } from '../../shared/security/VaultProvider';

function FontSizeOption({ size, active, onClick, label }: { size: FontSizePreference; active: boolean; onClick: () => void; label: string }) {
  const scale = size === 'small' ? 0.85 : size === 'medium' ? 1 : size === 'intermediate' ? 1.1 : 1.2;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        borderRadius: 12,
        border: `2px solid ${active ? 'var(--color-primary, #1a73e8)' : 'var(--border)'}`,
        background: active ? 'color-mix(in srgb, var(--color-primary, #1a73e8) 8%, var(--bg))' : 'var(--bg)',
        cursor: 'pointer',
        transition: 'all 0.2s',
        flex: 1,
        outline: 'none',
      }}
      className="font-size-option"
    >
      <div style={{
        width: '100%',
        height: 70,
        borderRadius: 8,
        background: 'var(--bg-hover, #f5f5f5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 10,
        overflow: 'hidden',
        border: '1px solid var(--border)',
        position: 'relative',
      }}>
        {[0.9, 0.7, 0.8].map((w, i) => (
          <div
            key={i}
            style={{
              height: `${Math.round(scale * 8)}px`,
              borderRadius: 3,
              background: 'var(--text-muted)',
              width: `${w * 100}%`,
              opacity: 0.5,
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: `${Math.round(scale * 13)}px`, color: active ? 'var(--color-primary, #1a73e8)' : 'var(--text)', fontWeight: active ? 600 : 400 }}>
        {label}
      </span>
    </button>
  );
}

export function PreferencesSection() {
  const { t } = useTranslation();
  const { preference, setPreference } = useLanguage();
  const { layout, setLayout } = useLayout();
  const { preference: themePref, setPreference: setThemePref } = useTheme();
  const { fontSize, setFontSize } = useFontSize();
  const { token: logoDevToken, setToken: setLogoDevToken } = useLogoDevToken();
  const { lock, biometricAvailable, biometricEnabled, enableBiometrics, disableBiometrics } = useVault();
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [biometricDiagnostic, setBiometricDiagnostic] = useState('');
  const [diagnosticCopied, setDiagnosticCopied] = useState(false);

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

  const langOptions: { value: LanguagePreference; label: string; flag: string }[] = [
    { value: 'system', label: t('settings.language.system'), flag: '🖥' },
    { value: 'fr', label: t('settings.language.fr'), flag: '🇫🇷' },
    { value: 'en', label: t('settings.language.en'), flag: '🇬🇧' },
  ];

  const themeOptions: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
    { value: 'system', label: t('settings.theme.system'), icon: <Monitor size={15} /> },
    { value: 'light', label: t('settings.theme.light'), icon: <Sun size={15} /> },
    { value: 'dark', label: t('settings.theme.dark'), icon: <Moon size={15} /> },
  ];

  const layoutOptions: { value: AppLayout; label: string; icon: React.ReactNode }[] = [
    { value: 'tabbed', label: t('settings.layout.tabbed', 'Onglets'), icon: <LayoutPanelTop size={15} /> },
    { value: 'windows', label: t('settings.layout.windows', 'Fenêtres séparées'), icon: <Columns2 size={15} /> },
  ];

  const segmentStyle = {
    display: 'inline-flex' as const,
    border: '1px solid var(--border)',
    borderRadius: 8,
    overflow: 'hidden' as const,
    background: 'var(--bg-secondary, var(--bg))',
  };

  const btnStyle = (active: boolean, isFirst: boolean) => ({
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 7,
    padding: '8px 16px',
    border: 'none',
    borderLeft: isFirst ? 'none' : '1px solid var(--border)',
    background: active ? 'var(--color-primary, #1a73e8)' : 'transparent',
    color: active ? '#fff' : 'var(--text)',
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    fontSize: 'calc(14px * var(--font-scale, 1))',
    transition: 'background 0.15s, color 0.15s',
  });

  return (
    <div className="preferences-section" style={{ maxWidth: 480 }}>

      {/* Langue */}
      <div style={{ marginBottom: 28 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 'calc(15px * var(--font-scale, 1))', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Languages size={16} />
          {t('settings.language.sectionTitle')}
        </h3>
        <div className="preferences-segment" style={segmentStyle}>
          {langOptions.map((opt, i) => (
            <button className="preferences-segment-button" key={opt.value} type="button" onClick={() => setPreference(opt.value)} style={btnStyle(preference === opt.value, i === 0)}>
              <span style={{ fontSize: 'calc(16px * var(--font-scale, 1))', lineHeight: 1 }}>{opt.flag}</span>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Thème */}
      <div style={{ marginBottom: 28 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 'calc(15px * var(--font-scale, 1))', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sun size={16} />
          {t('settings.theme.sectionTitle')}
        </h3>
        <div className="preferences-segment" style={segmentStyle}>
          {themeOptions.map((opt, i) => (
            <button className="preferences-segment-button" key={opt.value} type="button" onClick={() => setThemePref(opt.value)} style={btnStyle(themePref === opt.value, i === 0)}>
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Layout */}
      <div style={{ marginBottom: 28 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 'calc(15px * var(--font-scale, 1))', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <LayoutPanelTop size={16} />
          {t('settings.layout.sectionTitle', 'Interface')}
        </h3>
        <div className="preferences-segment" style={segmentStyle}>
          {layoutOptions.map((opt, i) => (
            <button className="preferences-segment-button" key={opt.value} type="button" onClick={() => setLayout(opt.value)} style={btnStyle(layout === opt.value, i === 0)}>
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 'calc(12px * var(--font-scale, 1))', color: 'var(--text-muted, var(--text))', opacity: 0.6 }}>
          {t('settings.layout.hint', "Redémarrez l'application pour appliquer le mode Fenêtres séparées.")}
        </p>
      </div>

      {/* Taille de la police */}
      <div style={{ marginBottom: 28 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 'calc(15px * var(--font-scale, 1))', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Type size={16} />
          {t('settings.fontSize.sectionTitle', 'Taille de la police')}
        </h3>
        <div className="font-size-options" style={{ display: 'flex', gap: 12 }}>
          <FontSizeOption size="small" label={t('settings.fontSize.small', 'Petite')} active={fontSize === 'small'} onClick={() => setFontSize('small')} />
          <FontSizeOption size="medium" label={t('settings.fontSize.medium', 'Moyenne')} active={fontSize === 'medium'} onClick={() => setFontSize('medium')} />
          <FontSizeOption size="intermediate" label={t('settings.fontSize.intermediate', 'Intermédiaire')} active={fontSize === 'intermediate'} onClick={() => setFontSize('intermediate')} />
          <FontSizeOption size="large" label={t('settings.fontSize.large', 'Grande')} active={fontSize === 'large'} onClick={() => setFontSize('large')} />
        </div>
      </div>

      {/* Logo.dev token */}
      <div style={{ marginBottom: 28 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 'calc(15px * var(--font-scale, 1))', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Mail size={16} />
          {t('settings.logoDev.sectionTitle', 'Logos des contacts')}
        </h3>
        <p style={{ margin: '0 0 10px', fontSize: 'calc(12px * var(--font-scale, 1))', color: 'var(--text-muted)', opacity: 0.7 }}>
          {t('settings.logoDev.hint', "Token logo.dev pour afficher les logos d'entreprise dans les avatars.")}
        </p>
        <input
          type="password"
          value={logoDevToken}
          onChange={e => setLogoDevToken(e.target.value)}
          placeholder="pk_..."
          style={{
            width: '100%',
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg)',
            color: 'var(--text)',
            fontSize: 'calc(13px * var(--font-scale, 1))',
            boxSizing: 'border-box',
            outline: 'none',
          }}
        />
      </div>

      <div style={{ marginBottom: 28 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 'calc(15px * var(--font-scale, 1))', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Lock size={16} /> {t('settings.vault.sectionTitle')}
        </h3>
        <p style={{ margin: '0 0 10px', fontSize: 'calc(12px * var(--font-scale, 1))', color: 'var(--text-muted)', opacity: 0.7 }}>
          {t('settings.vault.hint')}
        </p>
        {biometricAvailable ? <>
          <div className="vault-settings-actions">
            <button className={biometricEnabled ? 'btn-ghost' : 'btn-primary'} type="button" disabled={biometricBusy} onClick={() => void toggleBiometrics()}>
              <Fingerprint size={16} />
              {t(biometricEnabled ? 'settings.vault.disableBiometrics' : 'settings.vault.enableBiometrics')}
            </button>
            <button className="btn-ghost" type="button" onClick={lock}>
              <Lock size={16} /> {t('settings.vault.lockNow')}
            </button>
          </div>
          {biometricDiagnostic && <div className="vault-diagnostic" role="alert">
            <p>{t('settings.vault.biometricError')}</p>
            <pre>{biometricDiagnostic}</pre>
            <button className="btn-ghost" type="button" onClick={() => void copyBiometricDiagnostic()}>
              {diagnosticCopied ? <Check size={15} /> : <Copy size={15} />}
              {t(diagnosticCopied ? 'settings.vault.diagnosticCopied' : 'settings.vault.copyDiagnostic')}
            </button>
          </div>}
        </> : <>
          <p style={{ fontSize: 12, opacity: .7 }}>{t('settings.vault.biometricUnavailable')}</p>
          <button className="btn-ghost" type="button" onClick={lock}><Lock size={16} /> {t('settings.vault.lockNow')}</button>
        </>}
      </div>

    </div>
  );
}
