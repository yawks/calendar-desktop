import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Menu,
  RefreshCw,
  Search,
  Settings,
} from 'lucide-react';

import { Link } from 'react-router-dom';
import { ViewType } from '../../../shared/types';
import { useTranslation } from 'react-i18next';

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
  readonly onSearch: () => void;
}

export default function AppHeader({
  view, onViewChange, onPrev, onNext, onToday, onRefresh, dateLabel, loading, onToggleSidebar, onSearch,
}: Props) {
  const { t } = useTranslation();

  const VIEW_TYPES: ViewType[] = ['day', 'workweek', 'week', 'month'];

  const isMac = navigator.userAgent.toUpperCase().includes('MAC');
  const shortcutLabel = isMac ? '⌘K' : 'Ctrl+K';

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

      <button className="btn-search" onClick={onSearch} title={t('search.open')}>
        <Search size={16} />
        <span className="btn-search-label">{t('search.button')}</span>
        <kbd className="btn-search-kbd">{shortcutLabel}</kbd>
      </button>

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

      <Link to="/config" className="btn-config" title={t('header.configCalendars')}>
        <Settings size={17} />
      </Link>
    </header>
  );
}
