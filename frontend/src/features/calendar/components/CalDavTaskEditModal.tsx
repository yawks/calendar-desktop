import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { CalendarConfig, CalendarEvent } from '../../../shared/types';
import { calDavLoadError } from '../utils/loadCalDavCalendar';
import { CalDavTaskDraft, isCalDavTaskConflict, reloadCalDavTask, updateCalDavTask } from '../utils/caldavTaskApi';

function initialDraft(event: CalendarEvent): CalDavTaskDraft {
  return { title: event.caldavTask!.title, description: event.description ?? '',
    due: event.caldavTask!.due, start: event.caldavTask!.start, completed: false };
}

export default function CalDavTaskEditModal({ event, calendar, onClose, onSaved }: {
  event: CalendarEvent; calendar: CalendarConfig; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const [source, setSource] = useState(event);
  const [draft, setDraft] = useState(() => initialDraft(event));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [reloaded, setReloaded] = useState(false);
  useLayoutEffect(() => {
    const opener = document.activeElement;
    ref.current?.showModal();
    return () => { ref.current?.close(); if (opener instanceof HTMLElement) opener.focus(); };
  }, []);
  const change = (patch: Partial<CalDavTaskDraft>) => { setDraft(previous => ({ ...previous, ...patch })); setReloaded(false); setError(''); };
  const dateField = (name: 'due' | 'start', label: string) => {
    const value = draft[name];
    if (!value) return null;
    const zone = source.caldavTask![name === 'due' ? 'dueZone' : 'startZone'];
    const update = (date: string, time: string) => {
      if (!date) return;
      change({ [name]: time ? `${date}T${time}:00${source.caldavTask![name]?.endsWith('Z') ? 'Z' : ''}` : date });
    };
    return <fieldset className="caldav-task-editor__dates" key={name}>
      <legend>{label}</legend>
      <div className="config-form-grid caldav-task-editor__grid">
        <label className="caldav-task-editor__field" htmlFor={`${id}-${name}-date`}>
          <span>{t('caldavTask.date')}</span>
          <input id={`${id}-${name}-date`} type="date" required value={value.slice(0, 10)} disabled={busy || saved} onChange={e => update(e.target.value, value.slice(11, 16))} />
        </label>
        <label className="caldav-task-editor__field" htmlFor={`${id}-${name}-time`}>
          <span>{t('caldavTask.time')}</span>
          <input id={`${id}-${name}-time`} type="time" value={value.slice(11, 16)} disabled={busy || saved} onChange={e => update(value.slice(0, 10), e.target.value)} />
        </label>
      </div>
      <p className="caldav-task-editor__help">{zone ? t('caldavTask.timeZone', { zone }) : t('caldavTask.localTime')}</p>
    </fieldset>;
  };
  return <dialog ref={ref} className="modal-dialog modal-dialog--form caldav-task-editor" aria-labelledby={`${id}-title`} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal">
      <div className="modal-header" style={{ background: calendar.color }}>
        <h2 id={`${id}-title`} className="modal-title">{t('caldavTask.edit')}</h2>
        <button type="button" className="btn-icon modal-close" disabled={busy} onClick={onClose} aria-label={t('caldavTask.close')} title={t('caldavTask.close')}><X size={16} /></button>
      </div>
      <form className="config-form caldav-task-editor__form" onSubmit={async e => {
        e.preventDefault();
        if (busy || saved || conflict) return;
        setBusy(true); setError(''); setReloaded(false);
        try { await updateCalDavTask(source, calendar, draft); setSaved(true); onSaved(); }
        catch (cause) {
          if (isCalDavTaskConflict(cause)) setConflict(true);
          else setError(cause instanceof Error && [t('caldavTask.required'), t('caldavTask.dateOrder'), t('caldavTask.unavailable')].includes(cause.message) ? cause.message : calDavLoadError(cause));
        } finally { setBusy(false); }
      }}>
        {source.caldavTask?.project && <p className="caldav-task-editor__help">{t('caldavTask.project')}: {source.caldavTask.project}</p>}
        {!!source.caldavTask?.categories.length && <p className="caldav-task-editor__help">{t('caldavTask.labels')}: {source.caldavTask.categories.join(', ')}</p>}
        <label className="caldav-task-editor__field" htmlFor={`${id}-summary`}>
          <span>{t('caldavTask.title')}</span>
          <input id={`${id}-summary`} type="text" autoComplete="off" autoFocus required value={draft.title} disabled={busy || saved} onChange={e => change({ title: e.target.value })} />
        </label>
        {dateField('due', t('caldavTask.due'))}
        {source.caldavTask?.start !== source.caldavTask?.due && dateField('start', t('caldavTask.start'))}
        <label className="caldav-task-editor__field" htmlFor={`${id}-description`}>
          <span>{t('caldavTask.description')}</span>
          <textarea id={`${id}-description`} rows={4} value={draft.description} disabled={busy || saved} onChange={e => change({ description: e.target.value })} />
        </label>
        <label className="caldav-task-editor__completed"><input type="checkbox" checked={draft.completed} disabled={busy || saved} onChange={e => change({ completed: e.target.checked })} /><span>{t('caldavTask.complete')}</span></label>
        <p className="caldav-task-editor__help">{t('caldavTask.completionHelp')}</p>
        {error && <p className="caldav-task-editor__error" role="alert">{error}</p>}
        {conflict && <p className="caldav-task-editor__error" role="alert">{t('caldavTask.conflict')}</p>}
        {(saved || reloaded) && <p className="caldav-task-editor__help" role="status">{t(saved ? 'caldavTask.saved' : 'caldavTask.reloaded')}</p>}
        {!saved && <div className="config-form-footer caldav-task-editor__actions">
          {!saved && !conflict && <button type="submit" className="btn-primary" disabled={busy} aria-busy={busy}>{t(busy ? 'caldavTask.saving' : 'caldavTask.save')}</button>}
          {conflict && <button type="button" className="btn-primary" disabled={busy} aria-busy={busy} onClick={async () => {
            setBusy(true); setError('');
            try { const latest = await reloadCalDavTask(source, calendar); setSource(latest); setDraft(initialDraft(latest)); setConflict(false); setReloaded(true); }
            catch (cause) { setError(cause instanceof Error && cause.message === t('caldavTask.unavailable') ? cause.message : calDavLoadError(cause)); }
            finally { setBusy(false); }
          }}>{t('caldavTask.reload')}</button>}
          {!saved && <button type="button" className="btn-ghost" disabled={busy} onClick={onClose}>{t('caldavTask.cancel')}</button>}
        </div>}
      </form>
    </div>
  </dialog>;
}
