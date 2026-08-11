import { useTranslation } from 'react-i18next';
import { Columns2, Languages, LayoutPanelTop, Lock, Mail, Monitor, Moon, Sun, Type } from 'lucide-react';
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
  const { lock } = useVault();

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
    <div style={{ maxWidth: 480 }}>

      {/* Langue */}
      <div style={{ marginBottom: 28 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 'calc(15px * var(--font-scale, 1))', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Languages size={16} />
          {t('settings.language.sectionTitle')}
        </h3>
        <div style={segmentStyle}>
          {langOptions.map((opt, i) => (
            <button key={opt.value} type="button" onClick={() => setPreference(opt.value)} style={btnStyle(preference === opt.value, i === 0)}>
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
        <div style={segmentStyle}>
          {themeOptions.map((opt, i) => (
            <button key={opt.value} type="button" onClick={() => setThemePref(opt.value)} style={btnStyle(themePref === opt.value, i === 0)}>
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
        <div style={segmentStyle}>
          {layoutOptions.map((opt, i) => (
            <button key={opt.value} type="button" onClick={() => setLayout(opt.value)} style={btnStyle(layout === opt.value, i === 0)}>
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
        <div style={{ display: 'flex', gap: 12 }}>
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
        <button type="button" onClick={lock} style={{ padding: '8px 14px' }}>{t('settings.vault.lockNow')}</button>
      </div>

    </div>
  );
}
