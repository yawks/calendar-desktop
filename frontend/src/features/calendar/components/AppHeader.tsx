import {
  ChevronLeft,
  ChevronRight,
  Ban,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock3,
  ListFilter,
  Loader2,
  Menu,
  RefreshCw,
  Search,
  Settings,
} from 'lucide-react';

import { Link } from 'react-router-dom';
import AppViewMenu from '../../../shared/components/AppViewMenu';
import { ViewType } from '../../../shared/types';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';

export type EventVisibilityStatus = 'accepted' | 'tentative' | 'pending' | 'declined' | 'cancelled';

function EventStatusIcon({ status }: { readonly status: EventVisibilityStatus }) {
  const iconProps = { size: 15, strokeWidth: 1.8, 'aria-hidden': true as const };
  switch (status) {
    case 'accepted': return <CircleCheck {...iconProps} />;
    case 'tentative': return <CircleDashed {...iconProps} />;
    case 'pending': return <Clock3 {...iconProps} />;
    case 'declined': return <CircleX {...iconProps} />;
    case 'cancelled': return <Ban {...iconProps} />;
  }
}

interface Props {
  readonly view: ViewType;
  readonly onViewChange: (v: ViewType) => void;
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly onToday: () => void;
  readonly onRefresh: () => void | Promise<void>;
  readonly dateLabel: string;
  readonly loading: boolean;
  readonly onToggleSidebar: () => void;
  readonly onSearch: () => void;
  readonly visibleEventStatuses: ReadonlySet<EventVisibilityStatus>;
  readonly onToggleEventStatus: (status: EventVisibilityStatus) => void;
}

export default function AppHeader({
  view, onViewChange, onPrev, onNext, onToday, onRefresh, dateLabel, loading, onToggleSidebar, onSearch,
  visibleEventStatuses, onToggleEventStatus,
}: Props) {
  const { t } = useTranslation();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);

  const VIEW_TYPES: ViewType[] = ['day', 'workweek', 'week', 'month'];

  const isMac = navigator.userAgent.toUpperCase().includes('MAC');
  const shortcutLabel = isMac ? '⌘K' : 'Ctrl+K';
  const eventStatuses: EventVisibilityStatus[] = ['accepted', 'tentative', 'pending', 'declined', 'cancelled'];

  useEffect(() => {
    if (!filtersOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!filtersRef.current?.contains(event.target as Node)) setFiltersOpen(false);
    };
    globalThis.addEventListener('pointerdown', handlePointerDown);
    return () => globalThis.removeEventListener('pointerdown', handlePointerDown);
  }, [filtersOpen]);

  return (
    <header className="header">
      <button className="btn-icon" onClick={onToggleSidebar} title={t('header.toggleSidebar')}>
        <Menu size={20} />
      </button>

      <AppViewMenu current="calendar" />

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

      <button className="btn-icon" onClick={() => void onRefresh()} title={t('header.refresh')} disabled={loading}>
        <RefreshCw size={17} className={loading ? 'spin' : undefined} />
      </button>

      <div className="event-filters" ref={filtersRef}>
        <button
          type="button"
          className={`event-filters-toggle${visibleEventStatuses.size < eventStatuses.length ? ' active' : ''}`}
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          aria-haspopup="menu"
          title={t('header.eventFilters')}
        >
          <ListFilter size={14} />
          <span>{t('header.events')}</span>
        </button>

        {filtersOpen && (
          <div className="event-filters-popover" role="menu" aria-label={t('header.eventFilters')}>
            <div className="event-filters-title">{t('header.showEvents')}</div>
            {eventStatuses.map((status) => (
              <label className="event-filter-option" key={status}>
                <input
                  type="checkbox"
                  className="mail-thread-toolbar__checkbox"
                  checked={visibleEventStatuses.has(status)}
                  onChange={() => onToggleEventStatus(status)}
                />
                <span className={`event-filter-option-icon event-filter-option-icon--${status}`}>
                  <EventStatusIcon status={status} />
                </span>
                <span>{t(`header.eventStatuses.${status}`)}</span>
              </label>
            ))}
          </div>
        )}
      </div>

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
