import { CalendarClock, ChevronDown, Clock3 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const localValue = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function ScheduledSendMenu({ disabled, onSchedule }: { disabled: boolean; onSchedule: (date: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const [customDate, setCustomDate] = useState(() => localValue(tomorrow));
  const schedule = (date: Date) => { setOpen(false); onSchedule(date.toISOString()); };
  return <div className="mail-actions-dropdown mail-scheduled-send">
    <button type="button" className="btn-primary mail-scheduled-send__toggle" disabled={disabled} title={t('mail.scheduleSend', 'Programmer l’envoi')} onClick={() => setOpen(value => !value)}>
      <ChevronDown size={15} />
    </button>
    {open && <div className="mail-actions-backdrop" onClick={() => setOpen(false)} />}
    {open && <div className="mail-actions-menu mail-snooze-menu">
      <button type="button" className="mail-actions-menu__item" onClick={() => schedule(tomorrow)}><Clock3 size={15} />{t('mail.sendTomorrowMorning', 'Demain matin')} · 09:00</button>
      <div className="mail-snooze-custom">
        <label><CalendarClock size={15} /> {t('mail.chooseSendDateTime', 'Choisir une date et une heure')}</label>
        <div className="mail-snooze-custom__fields"><input type="datetime-local" min={localValue(new Date(Date.now() + 60_000))} value={customDate} onChange={event => setCustomDate(event.target.value)} /></div>
        <div className="mail-snooze-custom__actions"><button type="button" className="btn-primary" disabled={!customDate || new Date(customDate).getTime() <= Date.now()} onClick={() => schedule(new Date(customDate))}>{t('mail.schedule', 'Programmer')}</button></div>
      </div>
    </div>}
  </div>;
}
