import { CalendarDays, Check, ChevronDown, Mail } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppTab, useLayout } from '../store/LayoutStore';
import { useAppCapabilities } from '../hooks/useAppCapabilities';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { makeWindowIcon, openOrFocusWindow } from './WindowSwitcher';

interface Props {
  readonly current: AppTab;
}

export default function AppViewMenu({ current }: Props) {
  const { t } = useTranslation();
  const { layout, setActiveTab } = useLayout();
  const { hasCalendar, hasMail } = useAppCapabilities();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const canSwitch = hasCalendar && hasMail;
  const label = current === 'mail'
    ? t('tabs.mail', 'Mail')
    : t('tabs.calendar', 'Calendrier');

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (layout !== 'windows') return;
    makeWindowIcon(current).then(bytes => {
      getCurrentWindow().setIcon(bytes).catch(() => {});
    });
  }, [current, layout]);

  if (!canSwitch) {
    return <span className="header-logo"><span>{label}</span></span>;
  }

  const select = async (tab: AppTab) => {
    setOpen(false);
    if (tab === current) return;
    if (layout === 'tabbed') {
      setActiveTab(tab);
      return;
    }

    if (tab === 'calendar') {
      await openOrFocusWindow(
        'calendar',
        globalThis.location.origin + '/calendar',
        t('tabs.calendar', 'Calendrier'),
        'calendar',
      );
    } else {
      await openOrFocusWindow(
        'main',
        globalThis.location.origin + '/',
        t('tabs.mail', 'Mail'),
        'mail',
      );
    }
  };

  return (
    <div className="app-view-menu" ref={rootRef}>
      <button
        type="button"
        className="header-logo app-view-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <span>{label}</span>
        <ChevronDown size={17} strokeWidth={2.4} className={open ? 'app-view-menu__chevron--open' : ''} />
      </button>

      {open && (
        <div className="app-view-menu__popover" role="menu">
          <button type="button" role="menuitem" className="app-view-menu__item" onClick={() => select('mail')}>
            <Mail size={17} />
            <span>{t('tabs.mail', 'Mail')}</span>
            {current === 'mail' && <Check size={15} className="app-view-menu__check" />}
          </button>
          <button type="button" role="menuitem" className="app-view-menu__item" onClick={() => select('calendar')}>
            <CalendarDays size={17} />
            <span>{t('tabs.calendar', 'Calendrier')}</span>
            {current === 'calendar' && <Check size={15} className="app-view-menu__check" />}
          </button>
        </div>
      )}
    </div>
  );
}
