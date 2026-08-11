import { CalendarDays, Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { openAppWindow } from '../services/windowService';

interface Props {
  readonly target: 'mail' | 'calendar';
}

/** Kept as a compatibility export while callers migrate to windowService. */
export async function openOrFocusWindow(
  label: string,
  url: string,
  _title: string,
  _iconType: 'mail' | 'calendar',
) {
  openAppWindow(url, `courrier-${label}`);
}

export default function WindowSwitcher({ target }: Props) {
  const { t } = useTranslation();
  const handleClick = () => {
    const calendar = target === 'calendar';
    openAppWindow(calendar ? '/calendar' : '/', calendar ? 'courrier-calendar' : 'courrier-mail');
  };

  return (
    <div className="app-tabs">
      <button className="app-tab" onClick={handleClick}>
        {target === 'calendar' ? (
          <><CalendarDays size={16} />{t('tabs.calendar', 'Calendrier')}</>
        ) : (
          <><Mail size={16} />{t('tabs.mail', 'Mail')}</>
        )}
      </button>
    </div>
  );
}
