import { CalendarDays, Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppTab } from '../store/LayoutStore';

interface Props {
  active: AppTab;
  onChange: (tab: AppTab) => void;
}

export default function AppTabs({ active, onChange }: Props) {
  const { t } = useTranslation();

  return (
    <div className="app-tabs">
      <button
        className={`app-tab ${active === 'calendar' ? 'active' : ''}`}
        onClick={() => onChange('calendar')}
      >
        <CalendarDays size={16} />
        {t('tabs.calendar', 'Calendrier')}
      </button>
      <button
        className={`app-tab ${active === 'mail' ? 'active' : ''}`}
        onClick={() => onChange('mail')}
      >
        <Mail size={16} />
        {t('tabs.mail', 'Mail')}
      </button>
    </div>
  );
}
