import { useEffect, useState } from 'react';
import { CalendarDays, RefreshCw, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCalendars } from '../../features/calendar/store/CalendarStore';
import { useAndroidCalendars } from '../../features/calendar/store/AndroidCalendarProvider';

export function AndroidCalendarsSection() {
  const android = useAndroidCalendars();
  return android ? <CalendarSelection android={android} /> : null;
}
function CalendarSelection({ android }: { android: NonNullable<ReturnType<typeof useAndroidCalendars>> }) {
  const { t } = useTranslation();
  const { calendars } = useCalendars();
  const [selected, setSelected] = useState(android.selected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => setSelected(android.selected), [android.selected]);
  const act = async (save: boolean) => {
    setBusy(true);
    setError(false);
    try {
      if (save) await android.saveSelection(selected);
      else await android.refresh();
    } catch { setError(true); }
    finally { setBusy(false); }
  };
  const sourceError = android.selected.some(id => android.errors[id]);
  const failed = error || android.state === 'error' || sourceError;
  const syncing = busy || android.state === 'syncing';
  return <section className="native-settings-card preferences-card config-android-calendars" aria-labelledby="android-calendars-title">
    <header className="native-settings-card__header">
      <div className="native-settings-card__icon" aria-hidden="true"><CalendarDays size={20} /></div>
      <div><h3 id="android-calendars-title">{t('settings.androidCalendars.title')}</h3><p>{t('settings.androidCalendars.hint')}</p></div>
    </header>
    <p className="config-android-calendars__help">{t('settings.androidCalendars.privacy')}</p>
    <p className="config-android-calendars__help">{t('settings.androidCalendars.removal')}</p>
    {calendars.length ? <div className="config-android-calendars__list">
      {calendars.map(cal => <label className="preferences-toggle" key={cal.id}>
        <input type="checkbox" checked={selected.includes(cal.id)} disabled={busy} onChange={event => {
          setSelected(ids => event.target.checked ? [...ids, cal.id] : ids.filter(id => id !== cal.id));
          setError(false);
        }} />
        <span>{cal.name}{cal.ownerEmail && <small>{cal.ownerEmail}</small>}</span>
      </label>)}
    </div> : <p className="config-android-calendars__help">{t('settings.androidCalendars.empty')}</p>}
    <div className="native-settings-actions">
      <button type="button" className="btn-primary" disabled={syncing} aria-busy={syncing} onClick={() => void act(true)}><Save size={16} />{t('settings.androidCalendars.save')}</button>
      <button type="button" className="btn-ghost" disabled={syncing || !android.selected.length} onClick={() => void act(false)}><RefreshCw size={16} />{t('settings.androidCalendars.refresh')}</button>
    </div>
    {failed ? <p className="config-android-calendars__status config-android-calendars__status--error" role="alert">{t(sourceError && !error && android.state !== 'error' ? 'settings.androidCalendars.sourceError' : 'settings.androidCalendars.error')}</p>
      : syncing ? <p className="config-android-calendars__status" role="status">{t('settings.androidCalendars.syncing')}</p>
      : android.state === 'success' && <p className="config-android-calendars__status" role="status">{t('settings.androidCalendars.saved')}</p>}
  </section>;
}
