import { CalendarClock, ChevronDown, Clock3 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MailProviderCapabilities } from '../providers/MailProvider';

interface ScheduledSendMenuProps {
  capability?: MailProviderCapabilities['scheduledSend'];
  disabled: boolean;
  onSchedule: (sendAt: string) => void;
}

const toLocalInputValue = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

export function ScheduledSendMenu({ capability, disabled, onSchedule }: ScheduledSendMenuProps) {
  const { t, i18n } = useTranslation();
  const timeInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [customValue, setCustomValue] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    return toLocalInputValue(tomorrow);
  });

  const choices = useMemo(() => {
    const now = new Date();
    const later = new Date(now.getTime() + 3 * 60 * 60_000);
    later.setMinutes(0, 0, 0);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    const maximum = capability?.maxDelaySeconds
      ? now.getTime() + capability.maxDelaySeconds * 1000
      : Number.POSITIVE_INFINITY;
    return [
      { label: t('mail.sendLaterToday', 'Plus tard aujourd’hui'), date: later },
      { label: t('mail.sendTomorrowMorning', 'Demain matin'), date: tomorrow },
    ].filter(choice => choice.date.getTime() <= maximum);
  }, [capability?.maxDelaySeconds, t]);

  if (!capability?.supported) return null;

  const selectDate = (date: Date) => {
    if (date.getTime() <= Date.now()) return;
    setOpen(false);
    setCustom(false);
    onSchedule(date.toISOString());
  };
  const formatTime = (date: Date) => new Intl.DateTimeFormat(i18n.language, {
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  }).format(date);
  const maxDate = capability.maxDelaySeconds
    ? toLocalInputValue(new Date(Date.now() + capability.maxDelaySeconds * 1000))
    : undefined;
  const [customDate = '', customTime = ''] = customValue.split('T');
  const minValue = toLocalInputValue(new Date(Date.now() + 60_000));
  const [minDate = '', minTime = ''] = minValue.split('T');
  const [maxDateValue, maxTime = ''] = maxDate?.split('T') ?? [];
  const customTimestamp = customValue ? new Date(customValue).getTime() : Number.NaN;
  const customValid = Number.isFinite(customTimestamp)
    && customTimestamp > Date.now()
    && (!capability.maxDelaySeconds || customTimestamp <= Date.now() + capability.maxDelaySeconds * 1000);

  return (
    <div className="mail-actions-dropdown mail-scheduled-send">
      <button
        type="button"
        className="btn-primary mail-scheduled-send__toggle"
        disabled={disabled}
        aria-label={t('mail.scheduleSend', 'Programmer l’envoi')}
        title={t('mail.scheduleSend', 'Programmer l’envoi')}
        onClick={() => { setOpen(value => !value); setCustom(false); }}
      >
        <ChevronDown size={14} />
      </button>
      {open && <div className="mail-actions-backdrop" onClick={() => setOpen(false)} />}
      {open && (
        <div className="mail-actions-menu mail-snooze-menu">
          {choices.map(choice => (
            <button key={choice.date.toISOString()} type="button" className="mail-actions-menu__item" onClick={() => selectDate(choice.date)}>
              <Clock3 size={15} />
              <span>{choice.label}</span>
              <span className="mail-scheduled-send__time">{formatTime(choice.date)}</span>
            </button>
          ))}
          <button type="button" className="mail-actions-menu__item" onClick={() => setCustom(value => !value)}>
            <CalendarClock size={15} />
            {t('mail.chooseSendDateTime', 'Choisir une date et une heure')}
          </button>
          {custom && (
            <div className="mail-snooze-custom">
              <div className="mail-snooze-custom__fields">
                <input
                  type="date"
                  value={customDate}
                  min={minDate}
                  max={maxDateValue}
                  aria-label={t('mail.sendDate', 'Date d’envoi')}
                  onChange={event => {
                    setCustomValue(`${event.target.value}T${customTime}`);
                    event.currentTarget.blur();
                    timeInputRef.current?.focus();
                    try {
                      timeInputRef.current?.showPicker();
                    } catch {
                      // Some Android WebViews only allow their picker to open
                      // from a direct tap; keeping focus on the field is enough.
                    }
                  }}
                />
                <input
                  ref={timeInputRef}
                  type="time"
                  value={customTime}
                  min={customDate === minDate ? minTime : undefined}
                  max={maxDateValue && customDate === maxDateValue ? maxTime : undefined}
                  aria-label={t('mail.sendTime', 'Heure d’envoi')}
                  onChange={event => setCustomValue(`${customDate}T${event.target.value}`)}
                />
              </div>
              <div className="mail-snooze-custom__actions">
                <button type="button" onClick={() => setCustom(false)}>{t('common.cancel', 'Annuler')}</button>
                <button type="button" className="btn-primary" disabled={!customValid} onClick={() => selectDate(new Date(customValue))}>
                  {t('mail.schedule', 'Programmer')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
