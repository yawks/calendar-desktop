import { Link } from 'react-router-dom';
import {
  CalendarDays, ChevronLeft, ChevronRight,
  RefreshCw, Settings, Sun, Moon, Monitor, Loader2, Menu,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ViewType } from '../types';
import { useTheme, ThemePreference } from '../store/ThemeStore';

interface Props {
  readonly view: ViewType;
  readonly onViewChange: (v: ViewType) => void;
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly onToday: () => void;
  readonly onRefresh: () => void;
  readonly dateLabel: string;
  readonly loading: boolean;
  readonly onToggleSidebar: () => void;
}

const THEME_CYCLE: ThemePreference[] = ['system', 'light', 'dark'];

function ThemeIcon({ pref }: { readonly pref: ThemePreference }) {
  if (pref === 'light') return <Sun size={18} />;
  if (pref === 'dark') return <Moon size={18} />;
  return <Monitor size={18} />;
}

export default function AppHeader({
  view, onViewChange, onPrev, onNext, onToday, onRefresh, dateLabel, loading, onToggleSidebar,
}: Props) {
  const { t } = useTranslation();
  const { preference, setPreference } = useTheme();

  const cycleTheme = () => {
    const idx = THEME_CYCLE.indexOf(preference);
    setPreference(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
  };

  const VIEW_TYPES: ViewType[] = ['day', 'workweek', 'week', 'month'];

  return (
    <header className="header">
      <button className="btn-icon" onClick={onToggleSidebar} title={t('header.toggleSidebar')}>
        <Menu size={20} />
      </button>

      <span className="header-logo">
        <CalendarDays size={22} strokeWidth={1.5} />
        <span>{t('header.appName')}</span>
      </span>

      <button className="btn-today" onClick={onToday}>{t('header.today')}</button>

      <div className="header-nav">
        <button className="btn-icon" onClick={onPrev} title={t('header.prev')}>
          <ChevronLeft size={20} />
        </button>
        <button className="btn-icon" onClick={onNext} title={t('header.next')}>
          <ChevronRight size={20} />
        </button>
      </div>

      <span className="header-date-label">{dateLabel}</span>

      <div className="header-spacer" />

      {loading && <Loader2 size={18} className="spin" />}

      <button className="btn-icon" onClick={onRefresh} title={t('header.refresh')}>
        <RefreshCw size={17} />
      </button>

      <div className="view-switcher">
        {VIEW_TYPES.map((v) => (
          <button key={v} className={view === v ? 'active' : ''} onClick={() => onViewChange(v)}>
            {t(`header.views.${v}`)}
          </button>
        ))}
      </div>

      <button className="btn-icon" onClick={cycleTheme} title={t('header.theme', { preference })}>
        <ThemeIcon pref={preference} />
      </button>

      <Link to="/config" className="btn-config" title={t('header.configCalendars')}>
        <Settings size={17} />
        {t('header.calendarsBtn')}
      </Link>
    </header>
  );
}
