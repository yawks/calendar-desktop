import {
  ChevronLeft,
  ChevronRight,
  Ban,
  CalendarCheck,
  CalendarRange,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock3,
  ListFilter,
  Menu,
  MoreVertical,
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  const VIEW_TYPES: ViewType[] = ['day', 'workweek', 'week', 'month'];

  const isMac = navigator.userAgent.toUpperCase().includes('MAC');
  const shortcutLabel = isMac ? '⌘K' : 'Ctrl+K';
  const eventStatuses: EventVisibilityStatus[] = ['accepted', 'tentative', 'pending', 'declined', 'cancelled'];

  useEffect(() => {
    if (!filtersOpen && !mobileMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!filtersRef.current?.contains(event.target as Node)) setFiltersOpen(false);
      if (!mobileMenuRef.current?.contains(event.target as Node)) setMobileMenuOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFiltersOpen(false);
        setMobileMenuOpen(false);
      }
    };
    globalThis.addEventListener('pointerdown', handlePointerDown);
    globalThis.addEventListener('keydown', handleEscape);
    return () => {
      globalThis.removeEventListener('pointerdown', handlePointerDown);
      globalThis.removeEventListener('keydown', handleEscape);
    };
  }, [filtersOpen, mobileMenuOpen]);

  return (
    <>
    <header className="header app-shell-header app-mobile-header">
      <button className="btn-icon app-mobile-header__sidebar" onClick={onToggleSidebar} title={t('header.toggleSidebar')}>
        <Menu size={20} />
      </button>

      <AppViewMenu current="calendar" />

      <div className="calendar-mobile-more-menu app-mobile-header__more" ref={mobileMenuRef}>
        <button
          type="button"
          className="btn-icon"
          onClick={() => setMobileMenuOpen((open) => !open)}
          aria-expanded={mobileMenuOpen}
          aria-haspopup="menu"
          aria-label={t('mail.moreActions')}
          title={t('mail.moreActions')}
        >
          <MoreVertical size={21} aria-hidden="true" />
        </button>
        {mobileMenuOpen && (
          <div className="mail-actions-menu calendar-mobile-more-menu__content" role="menu" aria-label={t('mail.moreActions')}>
            <div className="calendar-mobile-more-menu__label">{t('header.changeView')}</div>
            {VIEW_TYPES.map((mobileView) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={view === mobileView}
                className={`mail-actions-menu__item${view === mobileView ? ' mail-actions-menu__item--active' : ''}`}
                key={mobileView}
                onClick={() => {
                  onViewChange(mobileView);
                  setMobileMenuOpen(false);
                }}
              >
                <CalendarRange size={16} aria-hidden="true" />
                <span>{t(`header.views.${mobileView}`)}</span>
                {view === mobileView && <CircleCheck size={17} aria-hidden="true" />}
              </button>
            ))}
            <button type="button" role="menuitem" className="mail-actions-menu__item calendar-mobile-more-menu__separator" onClick={() => { onToday(); setMobileMenuOpen(false); }}>
              <CalendarCheck size={16} aria-hidden="true" />
              {t('header.today')}
            </button>
            <Link role="menuitem" className="mail-actions-menu__item" to="/config" onClick={() => setMobileMenuOpen(false)}>
              <Settings size={16} aria-hidden="true" />
              {t('mail.settings')}
            </Link>
          </div>
        )}
      </div>

      <button
        className="btn-today calendar-header-desktop-action"
        onClick={onToday}
        title={t('header.today')}
        aria-label={t('header.today')}
      >
        <CalendarCheck className="btn-today-icon" size={18} aria-hidden="true" />
        <span>{t('header.today')}</span>
      </button>

      <div className="header-nav">
        <button className="btn-icon" onClick={onPrev} title={t('header.prev')}>
          <ChevronLeft size={20} />
        </button>
        <button className="btn-icon" onClick={onNext} title={t('header.next')}>
          <ChevronRight size={20} />
        </button>
      </div>

      <span className="header-date-label">{dateLabel}</span>

      <div className="header-spacer app-mobile-header__spacer" />

      <button className="btn-search app-mobile-header__search" onClick={onSearch} title={t('search.open')}>
        <Search size={16} />
        <span className="btn-search-label">{t('search.button')}</span>
        <kbd className="btn-search-kbd">{shortcutLabel}</kbd>
      </button>

      <button className="btn-icon calendar-refresh-button app-mobile-header__sync" onClick={() => void onRefresh()} title={t('header.refresh')} aria-label={t('header.refresh')} disabled={loading} aria-busy={loading}>
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

      <Link to="/config" className="btn-icon btn-config calendar-header-desktop-action" title={t('header.configCalendars')} aria-label={t('header.configCalendars')}>
        <Settings size={17} />
      </Link>
    </header>
    <nav className="calendar-mobile-navigation" aria-label={dateLabel}>
      <div className="header-nav">
        <button className="btn-icon" onClick={onPrev} title={t('header.prev')} aria-label={t('header.prev')}>
          <ChevronLeft size={20} />
        </button>
        <button className="btn-icon" onClick={onNext} title={t('header.next')} aria-label={t('header.next')}>
          <ChevronRight size={20} />
        </button>
      </div>
      <span className="header-date-label">{dateLabel}</span>
    </nav>
    </>
  );
}
