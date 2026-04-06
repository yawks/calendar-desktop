import { Mail } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme, ThemePreference } from '../store/ThemeStore';
import { Sun, Moon, Monitor } from 'lucide-react';

function ThemeIcon({ pref }: { readonly pref: ThemePreference }) {
  if (pref === 'light') return <Sun size={18} />;
  if (pref === 'dark') return <Moon size={18} />;
  return <Monitor size={18} />;
}

const THEME_CYCLE: ThemePreference[] = ['system', 'light', 'dark'];

export default function MailApp() {
  const { t } = useTranslation();
  const { preference, setPreference } = useTheme();

  const cycleTheme = () => {
    const idx = THEME_CYCLE.indexOf(preference);
    setPreference(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
  };

  return (
    <div className="mail-app">
      <header className="header">
        <span className="header-logo">
          <Mail size={22} strokeWidth={1.5} />
          <span>{t('tabs.mail', 'Mail')}</span>
        </span>

        <div className="header-spacer" />

        <button className="btn-icon" onClick={cycleTheme}>
          <ThemeIcon pref={preference} />
        </button>

        <Link to="/config" className="btn-config" title={t('header.configCalendars')}>
          <Settings size={17} />
          {t('header.calendarsBtn')}
        </Link>
      </header>

      <div className="mail-placeholder">
        <Mail size={64} strokeWidth={1} style={{ opacity: 0.2 }} />
        <p style={{ opacity: 0.4 }}>{t('mail.comingSoon', 'Application mail — bientôt disponible')}</p>
      </div>
    </div>
  );
}
