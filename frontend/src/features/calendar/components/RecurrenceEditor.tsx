import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RecurrenceOptions, parseRecurrence, recurrenceRule, WEEKDAYS, Frequency } from '../utils/recurrence';

interface Props {
  start: string;
  allDay: boolean;
  existing: boolean;
  initialRule?: string | null;
  value: string | undefined;
  onChange: (rule: string | undefined) => void;
  disabled?: boolean;
  exchange?: boolean;
  onEditingChange: (editing: boolean) => void;
}

export default function RecurrenceEditor({ start, allDay, existing, initialRule, value, onChange, disabled, exchange, onEditingChange }: Props) {
  const { t, i18n } = useTranslation();
  const selectId = useId();
  const date = new Date(`${start.slice(0, 10)}T12:00:00`);
  const weekday = WEEKDAYS[(date.getDay() + 6) % 7] ?? 'MO';
  const [preset, setPreset] = useState(existing ? 'existing' : 'none');
  const [custom, setCustom] = useState(false);
  const [error, setError] = useState('');
  const [options, setOptions] = useState<RecurrenceOptions>({ frequency: 'WEEKLY', interval: 1, days: [weekday], monthly: 'date', ending: 'never', until: start.slice(0, 10), count: 13 });
  const parsedRule = initialRule ? parseRecurrence(initialRule, start) : null;
  useEffect(() => {
    if (parsedRule && preset === 'existing' && !custom) setOptions(parsedRule);
  }, [initialRule]);
  const describe = (rule: RecurrenceOptions) => {
    const days = WEEKDAYS.filter(day => rule.days.includes(day)).map(day => new Date(2026, 0, 5 + WEEKDAYS.indexOf(day)).toLocaleDateString(i18n.language, { weekday: 'short' })).join(', ');
    return [t('recurrence.summary', { interval: rule.interval, unit: t(`recurrence.${rule.frequency}`) }), rule.frequency === 'WEEKLY' ? days : '', rule.ending === 'count' ? t('recurrence.countSummary', { count: rule.count }) : rule.ending === 'until' ? t('recurrence.untilSummary', { date: rule.until }) : t('recurrence.never')].filter(Boolean).join(' · ');
  };
  const dayName = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(i18n.language, { weekday: 'long' });
  const ordinal = Math.ceil(date.getDate() / 7);
  const monthlyLabel = t(`recurrence.ordinal${ordinal}`, { day: dayName });
  const presets: Record<string, RecurrenceOptions> = {
    daily: { ...options, frequency: 'DAILY' },
    weekly: { ...options, frequency: 'WEEKLY', days: [weekday] },
    monthly: { ...options, frequency: 'MONTHLY', monthly: 'weekday' },
    yearly: { ...options, frequency: 'YEARLY' },
    weekdays: { ...options, frequency: 'WEEKLY', days: WEEKDAYS.slice(0, 5) },
  };
  useEffect(() => { onEditingChange(custom); }, [custom, onEditingChange]);
  useEffect(() => {
    if (presets[preset] && !Number.isNaN(date.getTime())) onChange(recurrenceRule({ ...presets[preset], interval: 1, ending: 'never' }, start, allDay));
  }, [start, allDay, preset]);
  function choose(next: string) {
    if (next === 'custom') {
      const selected = value ? parseRecurrence(value, start) : parsedRule;
      if (selected) setOptions(selected);
      setError(''); setCustom(true); return;
    }
    setPreset(next);
    setCustom(false);
    if (next === 'existing') onChange(undefined);
    else if (next === 'none') onChange('');
    else onChange(recurrenceRule({ ...presets[next], interval: 1, ending: 'never' }, start, allDay));
  }
  function apply() {
    try {
      if (exchange && options.frequency === 'YEARLY' && options.interval !== 1) { setError(t('recurrence.yearlyLimit')); return; }
      onChange(recurrenceRule(options, start, allDay));
      setPreset('custom'); setCustom(false); setError('');
    } catch { setError(t('recurrence.invalid')); }
  }
  return <fieldset className="event-recurrence" aria-label={t('recurrence.label')} disabled={disabled}>
    <div className="form-row">
      <label htmlFor={selectId}>{t('recurrence.label')}</label>
      <select id={selectId} value={preset} onChange={e => choose(e.target.value)}>
        {existing && <option value="existing">{t('recurrence.existing')}</option>}
        <option value="none">{t('recurrence.none')}</option>
        <option value="daily">{t('recurrence.daily')}</option>
        <option value="weekly">{t('recurrence.weekly', { day: dayName })}</option>
        <option value="monthly">{t('recurrence.monthly', { day: monthlyLabel })}</option>
        <option value="yearly">{t('recurrence.yearly', { date: Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(i18n.language, { day: 'numeric', month: 'long' }) })}</option>
        <option value="weekdays">{t('recurrence.weekdays')}</option>
        <option value="custom">{t('recurrence.custom')}</option>
      </select>
    </div>
    {preset === 'existing' && parsedRule && <p className="event-recurrence__help">{describe(parsedRule)}</p>}
    {existing && <p className="event-recurrence__help">{t('recurrence.seriesHelp')}</p>}
    {preset === 'custom' && !custom && value && <p className="event-recurrence__help" role="status">{describe(parseRecurrence(value, start) ?? options)}</p>}
    {custom && <div className="event-recurrence__custom">
      <h3>{t('recurrence.customTitle')}</h3>
      <div className="event-recurrence__grid">
        <label className="event-recurrence__field"><span>{t('recurrence.every')}</span><input type="number" min="1" max="999" value={options.interval} onChange={e => setOptions({ ...options, interval: Number(e.target.value) })} /></label>
        <label className="event-recurrence__field"><span>{t('recurrence.unit')}</span><select value={options.frequency} onChange={e => setOptions({ ...options, frequency: e.target.value as Frequency })}>{(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const).map(f => <option key={f} value={f}>{t(`recurrence.${f}`)}</option>)}</select></label>
      </div>
      {options.frequency === 'WEEKLY' && <fieldset className="event-recurrence__days"><legend>{t('recurrence.onDays')}</legend><div>{WEEKDAYS.map((day, index) => {
        const name = new Date(2026, 0, 5 + index).toLocaleDateString(i18n.language, { weekday: 'long' });
        return <button type="button" key={day} aria-label={name} title={name} aria-pressed={options.days.includes(day)} onClick={() => setOptions({ ...options, days: options.days.includes(day) ? options.days.filter(d => d !== day) : [...options.days, day] })}>{name.slice(0, 1).toLocaleUpperCase(i18n.language)}</button>;
      })}</div></fieldset>}
      {options.frequency === 'MONTHLY' && <label className="event-recurrence__field"><span>{t('recurrence.onDays')}</span><select value={options.monthly} onChange={e => setOptions({ ...options, monthly: e.target.value as 'date' | 'weekday' })}><option value="date">{t('recurrence.monthDate', { date: date.getDate() })}</option><option value="weekday">{monthlyLabel}</option></select></label>}
      <fieldset className="event-recurrence__ending"><legend>{t('recurrence.ends')}</legend>
        <label><input type="radio" name="recurrence-ending" checked={options.ending === 'never'} onChange={() => setOptions({ ...options, ending: 'never' })} />{t('recurrence.never')}</label>
        <label><input type="radio" name="recurrence-ending" checked={options.ending === 'until'} onChange={() => setOptions({ ...options, ending: 'until' })} />{t('recurrence.until')}</label>
        <label className="event-recurrence__field"><span className="event-recurrence__sr-only">{t('recurrence.until')}</span><input type="date" min={start.slice(0, 10)} disabled={options.ending !== 'until'} value={options.until} onChange={e => setOptions({ ...options, until: e.target.value })} /></label>
        <label><input type="radio" name="recurrence-ending" checked={options.ending === 'count'} onChange={() => setOptions({ ...options, ending: 'count' })} />{t('recurrence.after')}</label>
        <label className="event-recurrence__field event-recurrence__count"><span>{t('recurrence.occurrences')}</span><input type="number" min="1" max="999" disabled={options.ending !== 'count'} value={options.count} onChange={e => setOptions({ ...options, count: Number(e.target.value) })} /></label>
      </fieldset>
      {error && <p className="event-recurrence__error" role="alert">{error}</p>}
      <div className="event-recurrence__actions"><button type="button" className="btn-primary" onClick={apply}>{t('recurrence.done')}</button><button type="button" className="btn-ghost" onClick={() => { setCustom(false); setError(''); }}>{t('createEvent.cancel')}</button></div>
    </div>}
  </fieldset>;
}
