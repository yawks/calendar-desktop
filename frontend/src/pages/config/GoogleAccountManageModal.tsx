import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, X } from 'lucide-react';
import { useGoogleAuth } from '../../shared/store/GoogleAuthStore';
import { useCalendars } from '../../features/calendar/store/CalendarStore';
import { listCalendars } from '../../features/calendar/utils/googleCalendarApi';
import { CalendarConfig, GoogleAccount } from '../../shared/types';
import { CapBadge, DEFAULT_COLORS } from './ConfigShared';

interface GoogleCalEntry {
  id: string;
  summary: string;
  backgroundColor?: string;
  accessRole: string;
  primary?: boolean;
}

export function GoogleAccountManageModal({ account, existingCalendars, onClose }: {
  account: GoogleAccount;
  existingCalendars: CalendarConfig[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { removeAccount, getValidToken, updateAccountCapabilities } = useGoogleAuth();
  const { addCalendar, removeCalendar } = useCalendars();
  const [capabilities, setCapabilities] = useState<('calendar' | 'email')[]>(
    account.enabledCapabilities ?? ['calendar', 'email']
  );

  const handleCapabilityChange = (cap: 'calendar' | 'email', enabled: boolean) => {
    const next = enabled ? [...capabilities, cap] : capabilities.filter((c) => c !== cap);
    setCapabilities(next);
    updateAccountCapabilities(account.id, next);
  };
  const [gCals, setGCals] = useState<GoogleCalEntry[] | null>(null);
  const [loadingCals, setLoadingCals] = useState(false);
  const [calError, setCalError] = useState('');

  const connectedIds = new Set(
    existingCalendars
      .filter((c) => c.type === 'google' && c.googleAccountId === account.id)
      .map((c) => c.googleCalendarId)
  );

  useEffect(() => {
    (async () => {
      setLoadingCals(true);
      setCalError('');
      try {
        const token = await getValidToken(account.id);
        if (!token) throw new Error(t('config.invalidToken'));
        const items = await listCalendars(token);
        setGCals(items as GoogleCalEntry[]);
      } catch (err) {
        setCalError(err instanceof Error ? err.message : t('config.error'));
      } finally {
        setLoadingCals(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleCalendar = (gCal: GoogleCalEntry) => {
    const existing = existingCalendars.find(
      (c) => c.type === 'google' && c.googleCalendarId === gCal.id && c.googleAccountId === account.id
    );
    if (existing) {
      removeCalendar(existing.id);
    } else {
      addCalendar({
        name: gCal.summary,
        url: '',
        color: gCal.backgroundColor ?? DEFAULT_COLORS[existingCalendars.length % DEFAULT_COLORS.length],
        visible: true,
        ownerEmail: account.email,
        type: 'google',
        googleCalendarId: gCal.id,
        googleAccountId: account.id,
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {account.picture && (
              <img
                src={account.picture} alt={account.name}
                style={{ width: 28, height: 28, borderRadius: '50%' }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            <div>
              <div style={{ fontWeight: 600, fontSize: 'calc(15px * var(--font-scale, 1))' }}>{account.name}</div>
              <div style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: 'var(--text-muted)' }}>{account.email}</div>
            </div>
          </div>
          <button type="button" className="nc-modal-close" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="nc-modal-body">

          {loadingCals && (
            <div style={{ color: 'var(--text-muted)', fontSize: 'calc(14px * var(--font-scale, 1))', marginBottom: 16 }}>{t('config.loading')}</div>
          )}
          {calError && (
            <div style={{ color: 'var(--color-error, #d93025)', fontSize: 'calc(13px * var(--font-scale, 1))', marginBottom: 16 }}>{calError}</div>
          )}
          {gCals && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 20 }}>
              <div style={{ fontSize: 'calc(13px * var(--font-scale, 1))', color: 'var(--text-muted)', marginBottom: 12 }}>
                {t('config.selectCalendarsToShow')}
              </div>
              {gCals.map((gCal) => (
                <label
                  key={gCal.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '5px 0' }}
                >
                  <input
                    type="checkbox"
                    checked={connectedIds.has(gCal.id)}
                    onChange={() => toggleCalendar(gCal)}
                  />
                  <span style={{
                    width: 12, height: 12, borderRadius: '50%',
                    background: gCal.backgroundColor ?? '#888', flexShrink: 0, display: 'inline-block',
                  }} />
                  <div>
                    <div style={{ fontSize: 'calc(14px * var(--font-scale, 1))' }}>
                      {gCal.summary}{gCal.primary ? t('config.primaryCalendar') : ''}
                    </div>
                    {gCal.accessRole === 'reader' && (
                      <div style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: 'var(--text-muted)' }}>{t('config.readOnly')}</div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 'calc(13px * var(--font-scale, 1))', color: 'var(--text-muted)', marginBottom: 10 }}>{t('config.enabledServices')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(['calendar', 'email'] as const).map((cap) => (
                <label key={cap} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={capabilities.includes(cap)}
                    onChange={(e) => handleCapabilityChange(cap, e.target.checked)}
                    disabled={capabilities.length === 1 && capabilities.includes(cap)}
                  />
                  <CapBadge cap={cap} />
                  <span style={{ fontSize: 'calc(14px * var(--font-scale, 1))' }}>{t(`config.cap.${cap}`)}</span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                type="button"
                className="btn-remove"
                onClick={() => { removeAccount(account.id); onClose(); }}
                style={{ fontSize: 'calc(13px * var(--font-scale, 1))', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Trash2 size={14} /> {t('config.disconnectAccount')}
              </button>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
