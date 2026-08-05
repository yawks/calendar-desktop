import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Laptop, X } from 'lucide-react';
import { useCalendars } from '../../features/calendar/store/CalendarStore';
import { CalendarConfig } from '../../shared/types';

interface EKCalendarInfo {
  id: string;
  title: string;
  color: string;
  is_writable: boolean;
  source_title: string;
}

type EKStatus = 'unavailable' | 'not_determined' | 'restricted' | 'denied' | 'authorized' | 'write_only' | 'loading';

export function EventKitManageModal({ existingCalendars, onClose }: {
  existingCalendars: CalendarConfig[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { addCalendar, removeCalendar } = useCalendars();
  const [status, setStatus] = useState<EKStatus>('loading');
  const [ekCals, setEkCals] = useState<EKCalendarInfo[] | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');

  const connectedIds = new Set(
    existingCalendars
      .filter((c) => c.type === 'eventkit')
      .map((c) => c.eventKitCalendarId)
  );

  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const s = await invoke<string>('check_eventkit_status');
        setStatus(s as EKStatus);
        if (s === 'authorized' || s === 'write_only') {
          const cals = await invoke<EKCalendarInfo[]>('list_eventkit_calendars');
          setEkCals(cals);
        }
      } catch {
        setStatus('unavailable');
      }
    })();
  }, []);

  const requestAccess = async () => {
    setRequesting(true);
    setError('');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const newStatus = await invoke<string>('request_eventkit_access');
      setStatus(newStatus as EKStatus);
      if (newStatus === 'authorized' || newStatus === 'write_only') {
        const cals = await invoke<EKCalendarInfo[]>('list_eventkit_calendars');
        setEkCals(cals);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('config.accessRequestError'));
    } finally {
      setRequesting(false);
    }
  };

  const toggleCalendar = (ekCal: EKCalendarInfo) => {
    const existing = existingCalendars.find(
      (c) => c.type === 'eventkit' && c.eventKitCalendarId === ekCal.id
    );
    if (existing) {
      removeCalendar(existing.id);
    } else {
      addCalendar({
        name: ekCal.title,
        url: '',
        color: ekCal.color,
        visible: true,
        type: 'eventkit',
        eventKitCalendarId: ekCal.id,
      });
    }
  };

  return (
    <div
      className="nc-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="nc-modal-box nc-modal-box--wide">
        <div className="nc-modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Laptop size={16} /> macOS
          </h2>
          <button type="button" className="nc-modal-close" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="nc-modal-body">
          {status === 'loading' && (
            <div style={{ color: 'var(--text-muted)', fontSize: 'calc(14px * var(--font-scale, 1))' }}>{t('config.loading')}</div>
          )}
          {status === 'unavailable' && (
            <div className="empty-state">{t('config.macosUnavailable')}</div>
          )}
          {status === 'not_determined' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
              <p style={{ margin: 0, fontSize: 'calc(14px * var(--font-scale, 1))' }}>{t('config.macosNotAuthorized')}</p>
              <button type="button" className="btn-primary" onClick={requestAccess} disabled={requesting}>
                {requesting ? t('config.requestingAccess') : t('config.authorizeAccess')}
              </button>
              {error && <div style={{ color: 'var(--color-error, #d93025)', fontSize: 'calc(13px * var(--font-scale, 1))' }}>{error}</div>}
            </div>
          )}
          {(status === 'denied' || status === 'restricted') && (
            <div style={{
              padding: '12px 16px', background: 'var(--color-error-bg, #fce8e6)',
              borderRadius: 8, fontSize: 'calc(14px * var(--font-scale, 1))', color: 'var(--color-error, #d93025)',
            }}>
              {status === 'denied' ? t('config.accessDeniedMsg') : t('config.accessRestricted')}
            </div>
          )}
          {(status === 'authorized' || status === 'write_only') && ekCals && (
            ekCals.length === 0
              ? <div className="empty-state">{t('config.noCalendarsFound')}</div>
              : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ fontSize: 'calc(13px * var(--font-scale, 1))', color: 'var(--text-muted)', marginBottom: 12 }}>
                    {t('config.selectCalendarsToShow')}
                  </div>
                  {ekCals.map((ekCal) => (
                    <label
                      key={ekCal.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '5px 0' }}
                    >
                      <input
                        type="checkbox"
                        checked={connectedIds.has(ekCal.id)}
                        onChange={() => toggleCalendar(ekCal)}
                      />
                      <span style={{
                        width: 12, height: 12, borderRadius: '50%',
                        background: ekCal.color, flexShrink: 0, display: 'inline-block',
                      }} />
                      <div>
                        <div style={{ fontSize: 'calc(14px * var(--font-scale, 1))' }}>{ekCal.title}</div>
                        <div style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: 'var(--text-muted)' }}>
                          {ekCal.source_title}
                          {!ekCal.is_writable && ` · ${t('config.readOnly')}`}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )
          )}
        </div>
      </div>
    </div>
  );
}
