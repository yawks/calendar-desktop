import { useState, useEffect, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Laptop, Rss, Pencil, Trash2, Cloud, Plus, X, Languages, SlidersHorizontal, Settings2, Star, LayoutPanelTop, Columns2, Sun, Moon, Monitor, CalendarDays, Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { useLanguage } from '../shared/store/LanguageStore';
import { LanguagePreference } from '../i18n';
import { useLayout, AppLayout } from '../shared/store/LayoutStore';
import { useTheme, ThemePreference } from '../shared/store/ThemeStore';

// ── CalDAV connection test ────────────────────────────────────────────────────

interface TestResult {
  ok: boolean;
  message: string;
}

async function testNextcloudConnection(url: string, username: string, password: string): Promise<TestResult> {
  if (!url.trim()) return { ok: false, message: i18n.t('config.caldavUrlRequired') };
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const status = await invoke<number>('fetch_caldav_status', { url: url.trim(), username: username.trim(), password });
    if (status === 200 || status === 207) return { ok: true, message: i18n.t('config.connectionSuccess') };
    if (status === 401) return { ok: false, message: i18n.t('config.invalidCredentials') };
    if (status === 403) return { ok: false, message: i18n.t('config.accessForbidden') };
    if (status === 404) return { ok: false, message: i18n.t('config.urlNotFound') };
    return { ok: false, message: i18n.t('config.unexpectedResponse', { status }) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : i18n.t('config.unknownError') };
  }
}

import { useCalendars } from '../features/calendar/store/CalendarStore';
import { useGoogleAuth } from '../shared/store/GoogleAuthStore';
import { useExchangeAuth, parseExchangeToken } from '../shared/store/ExchangeAuthStore';
import { useImapAuth } from '../shared/store/ImapAuthStore';
import { getGoogleClientConfig, setGoogleClientConfig, clearGoogleClientConfig } from '../shared/store/googleClientConfig';
import { listCalendars } from '../features/calendar/utils/googleCalendarApi';
import { CalendarConfig, GoogleAccount, ExchangeAccount, ImapAccount } from '../shared/types';
import { useDefaultCalendar } from '../features/calendar/store/defaultCalendarStore';
import { ImapAccountManageModal } from './ImapAccountManageModal';

const DEFAULT_COLORS = [
  '#1a73e8', '#34a853', '#ea4335', '#fbbc04',
  '#9c27b0', '#00bcd4', '#ff5722', '#607d8b',
];

function nextColor(calendars: CalendarConfig[]) {
  return DEFAULT_COLORS[calendars.length % DEFAULT_COLORS.length];
}

type SectionType = 'providers' | 'preferences';

// ── Capability badge ──────────────────────────────────────────────────────────

function CapBadge({ cap }: { cap: 'calendar' | 'email' }) {
  const { t } = useTranslation();
  const isCalendar = cap === 'calendar';
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      padding: '2px 6px',
      borderRadius: 4,
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.03em',
      textTransform: 'uppercase' as const,
      background: isCalendar ? 'rgba(26, 115, 232, 0.12)' : 'rgba(156, 39, 176, 0.12)',
      color: isCalendar ? '#1a73e8' : '#9c27b0',
      flexShrink: 0,
    }}>
      {isCalendar ? <CalendarDays size={9} /> : <Mail size={9} />}
      {t(`config.cap.${cap}`)}
    </span>
  );
}

// ── Color swatches ────────────────────────────────────────────────────────────

function ColorSwatches({ colors, selected, onSelect }: {
  readonly colors: string[];
  readonly selected: string;
  readonly onSelect: (c: string) => void;
}) {
  return (
    <>
      {colors.map((c) => (
        <button
          key={c} type="button" onClick={() => onSelect(c)}
          style={{
            width: 24, height: 24, borderRadius: '50%', background: c, border: 'none',
            outline: selected === c ? `3px solid ${c}` : '2px solid transparent',
            outlineOffset: 2, cursor: 'pointer',
          }}
        />
      ))}
    </>
  );
}

// ── Unified calendar item ─────────────────────────────────────────────────────

function CalendarItem({ cal, isDefault, onSetDefault }: {
  cal: CalendarConfig;
  isDefault?: boolean;
  onSetDefault?: () => void;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  let meta = '';
  if (cal.type === 'google') {
    meta = cal.ownerEmail ?? '';
  } else if (!cal.type || cal.type === 'ics') {
    meta = cal.ownerEmail ? `${cal.ownerEmail} · ${cal.url}` : cal.url;
  } else if (cal.type === 'nextcloud') {
    const host = cal.nextcloudServerUrl ?? cal.url;
    meta = cal.nextcloudUsername ? `${cal.nextcloudUsername} · ${host}` : host;
  }
  return (
    <div
      className="cal-item"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="cal-item-dot" style={{ background: cal.color }} />
      <div className="cal-item-body">
        <div className="cal-item-name">{cal.name}</div>
        {meta && <div className="cal-item-meta">{meta}</div>}
      </div>
      {onSetDefault && (hovered || isDefault) && (
        <button
          type="button"
          className={`cal-item-default-btn${isDefault ? ' cal-item-default-btn--active' : ''}`}
          onClick={onSetDefault}
          title={isDefault ? t('config.defaultCalendar') : t('config.setAsDefault')}
        >
          <Star size={13} fill={isDefault ? 'currentColor' : 'none'} />
        </button>
      )}
    </div>
  );
}

// ── Group section with hover edit icon ────────────────────────────────────────

function GroupSection({
  title, icon, onEdit, children, caps, color, onColorChange,
}: {
  title: string;
  icon: React.ReactNode;
  onEdit: () => void;
  children: React.ReactNode;
  caps?: ('calendar' | 'email')[];
  color?: string;
  onColorChange?: (c: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="config-group">
      <div className="config-group-header">
        <div className="config-group-title" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {icon}{title}
          {caps && caps.length > 0 && (
            <div style={{ display: 'flex', gap: 4, marginLeft: 2 }}>
              {caps.map((cap) => <CapBadge key={cap} cap={cap} />)}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {onColorChange && (
            <label
              title={t('config.accountColor', 'Account color')}
              style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', position: 'relative' }}
            >
              <span style={{
                width: 14, height: 14, borderRadius: '50%',
                background: color ?? '#888',
                border: '2px solid var(--border)',
                display: 'inline-block',
                flexShrink: 0,
              }} />
              <input
                type="color"
                value={color ?? '#888888'}
                onChange={(e) => onColorChange(e.target.value)}
                style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
                tabIndex={-1}
              />
            </label>
          )}
          <button
            type="button"
            className="config-group-edit-btn"
            onClick={onEdit}
            title={t('config.edit')}
          >
            <Settings2 size={13} />
          </button>
        </div>
      </div>
      <div className="config-group-body">{children}</div>
    </div>
  );
}

// ── Connection test row ───────────────────────────────────────────────────────

function ConnectionTestRow({ result, testing, onTest }: {
  result: TestResult | null;
  testing: boolean;
  onTest: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0 8px' }}>
      <button
        type="button"
        className="btn-edit"
        onClick={onTest}
        disabled={testing}
        style={{ fontSize: 13, gap: 6, whiteSpace: 'nowrap' }}
      >
        {testing ? t('config.testing') : t('config.testConnectionBtn')}
      </button>
      {result && (
        <span style={{
          fontSize: 13,
          color: result.ok ? 'var(--color-success, #34a853)' : 'var(--color-error, #d93025)',
        }}>
          {result.ok ? '✓ ' : '✗ '}{result.message}
        </span>
      )}
    </div>
  );
}

// ── EventKit manage modal ─────────────────────────────────────────────────────

interface EKCalendarInfo {
  id: string;
  title: string;
  color: string;
  is_writable: boolean;
  source_title: string;
}

type EKStatus = 'unavailable' | 'not_determined' | 'restricted' | 'denied' | 'authorized' | 'write_only' | 'loading';

function EventKitManageModal({ existingCalendars, onClose }: {
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
            <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>{t('config.loading')}</div>
          )}
          {status === 'unavailable' && (
            <div className="empty-state">{t('config.macosUnavailable')}</div>
          )}
          {status === 'not_determined' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
              <p style={{ margin: 0, fontSize: 14 }}>{t('config.macosNotAuthorized')}</p>
              <button type="button" className="btn-primary" onClick={requestAccess} disabled={requesting}>
                {requesting ? t('config.requestingAccess') : t('config.authorizeAccess')}
              </button>
              {error && <div style={{ color: 'var(--color-error, #d93025)', fontSize: 13 }}>{error}</div>}
            </div>
          )}
          {(status === 'denied' || status === 'restricted') && (
            <div style={{
              padding: '12px 16px', background: 'var(--color-error-bg, #fce8e6)',
              borderRadius: 8, fontSize: 14, color: 'var(--color-error, #d93025)',
            }}>
              {status === 'denied' ? t('config.accessDeniedMsg') : t('config.accessRestricted')}
            </div>
          )}
          {(status === 'authorized' || status === 'write_only') && ekCals && (
            ekCals.length === 0
              ? <div className="empty-state">{t('config.noCalendarsFound')}</div>
              : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
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
                        <div style={{ fontSize: 14 }}>{ekCal.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
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

// ── Google account manage modal ───────────────────────────────────────────────

interface GoogleCalEntry {
  id: string;
  summary: string;
  backgroundColor?: string;
  accessRole: string;
  primary?: boolean;
}

function GoogleAccountManageModal({ account, existingCalendars, onClose }: {
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
  const [showOAuth, setShowOAuth] = useState(false);
  const [gcClientId, setGcClientId] = useState(() => getGoogleClientConfig()?.clientId ?? '');
  const [gcClientSecret, setGcClientSecret] = useState(() => getGoogleClientConfig()?.clientSecret ?? '');
  const [gcSaved, setGcSaved] = useState(false);

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

  const handleSaveCredentials = (e: FormEvent) => {
    e.preventDefault();
    if (gcClientId.trim() && gcClientSecret.trim()) {
      setGoogleClientConfig({ clientId: gcClientId.trim(), clientSecret: gcClientSecret.trim() });
    } else {
      clearGoogleClientConfig();
    }
    setGcSaved(true);
    setTimeout(() => setGcSaved(false), 2500);
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
              <div style={{ fontWeight: 600, fontSize: 15 }}>{account.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{account.email}</div>
            </div>
          </div>
          <button type="button" className="nc-modal-close" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="nc-modal-body">

          {/* Calendar list */}
          {loadingCals && (
            <div style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 16 }}>{t('config.loading')}</div>
          )}
          {calError && (
            <div style={{ color: 'var(--color-error, #d93025)', fontSize: 13, marginBottom: 16 }}>{calError}</div>
          )}
          {gCals && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 20 }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
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
                    <div style={{ fontSize: 14 }}>
                      {gCal.summary}{gCal.primary ? t('config.primaryCalendar') : ''}
                    </div>
                    {gCal.accessRole === 'reader' && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('config.readOnly')}</div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}

          {/* Capabilities */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>{t('config.enabledServices')}</div>
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
                  <span style={{ fontSize: 14 }}>{t(`config.cap.${cap}`)}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Footer: disconnect + OAuth */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                type="button"
                className="btn-remove"
                onClick={() => { removeAccount(account.id); onClose(); }}
                style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Trash2 size={14} /> {t('config.disconnectAccount')}
              </button>
              <button
                type="button"
                className="btn-edit"
                onClick={() => setShowOAuth((v) => !v)}
                style={{ fontSize: 12 }}
              >
                {t('config.oauthCredentials')}
              </button>
            </div>

            {showOAuth && (
              <div style={{ marginTop: 16 }}>
                <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  {t('config.oauthDescription')}
                </p>
                <form onSubmit={handleSaveCredentials} className="config-form">
                  <div className="form-row">
                    <label htmlFor="oauth-client-id">Client ID</label>
                    <input
                      id="oauth-client-id"
                      type="text"
                      placeholder="123456789-abc…apps.googleusercontent.com"
                      value={gcClientId}
                      onChange={(e) => setGcClientId(e.target.value)}
                    />
                  </div>
                  <div className="form-row">
                    <label htmlFor="oauth-client-secret">Client Secret</label>
                    <input
                      id="oauth-client-secret"
                      type="password"
                      placeholder="GOCSPX-…"
                      value={gcClientSecret}
                      onChange={(e) => setGcClientSecret(e.target.value)}
                    />
                  </div>
                  <div className="form-actions" style={{ alignItems: 'center', gap: 12 }}>
                    <button type="submit" className="btn-primary">{t('config.save')}</button>
                    {gcSaved && (
                      <span style={{ fontSize: 13, color: 'var(--color-success, #34a853)' }}>
                        {t('config.savedConfirmation')}
                      </span>
                    )}
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ICS manage modal ──────────────────────────────────────────────────────────

interface ICSEditState {
  name: string;
  url: string;
  color: string;
  ownerEmail: string;
}

function ICSManageModal({ calendars, onClose }: {
  calendars: CalendarConfig[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { removeCalendar, updateCalendar } = useCalendars();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<ICSEditState>({ name: '', url: '', color: '', ownerEmail: '' });

  const startEdit = (cal: CalendarConfig) => {
    setEditingId(cal.id);
    setEditState({ name: cal.name, url: cal.url, color: cal.color, ownerEmail: cal.ownerEmail ?? '' });
  };

  const saveEdit = (id: string) => {
    if (!editState.name.trim() || !editState.url.trim()) return;
    updateCalendar(id, {
      name: editState.name.trim(),
      url: editState.url.trim(),
      color: editState.color,
      ownerEmail: editState.ownerEmail.trim() || undefined,
    });
    setEditingId(null);
  };

  return (
    <div
      className="nc-modal-overlay"
      onClick={(e) => { if (editingId === null && e.target === e.currentTarget) onClose(); }}
    >
      <div className="nc-modal-box nc-modal-box--wide">
        <div className="nc-modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Rss size={16} /> ICS / iCal
          </h2>
          <button type="button" className="nc-modal-close" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="nc-modal-body">
          <div className="config-list" style={{ marginBottom: 0 }}>
            {calendars.map((cal) =>
              editingId === cal.id ? (
                <div className="config-item config-item--editing" key={cal.id}>
                  <div className="config-edit-form">
                    <div className="form-row">
                      <label htmlFor={`ics-name-${cal.id}`}>{t('config.nameLabel')}</label>
                      <input
                        id={`ics-name-${cal.id}`}
                        type="text"
                        value={editState.name}
                        onChange={(e) => setEditState((s) => ({ ...s, name: e.target.value }))}
                        autoFocus
                      />
                    </div>
                    <div className="form-row">
                      <label htmlFor={`ics-url-${cal.id}`}>{t('config.icsUrl')}</label>
                      <input
                        id={`ics-url-${cal.id}`}
                        type="url"
                        value={editState.url}
                        onChange={(e) => setEditState((s) => ({ ...s, url: e.target.value }))}
                      />
                    </div>
                    <div className="form-row">
                      <label htmlFor={`ics-email-${cal.id}`}>
                        {t('config.myEmail')}{' '}
                        <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>{t('config.optional')}</span>
                      </label>
                      <input
                        id={`ics-email-${cal.id}`}
                        type="email"
                        placeholder="moi@example.com"
                        value={editState.ownerEmail}
                        onChange={(e) => setEditState((s) => ({ ...s, ownerEmail: e.target.value }))}
                      />
                    </div>
                    <div className="form-row">
                      <label htmlFor={`ics-color-${cal.id}`}>{t('config.colorLabel')}</label>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <ColorSwatches
                          colors={DEFAULT_COLORS}
                          selected={editState.color}
                          onSelect={(c) => setEditState((s) => ({ ...s, color: c }))}
                        />
                        <input
                          id={`ics-color-${cal.id}`}
                          type="color"
                          value={editState.color}
                          onChange={(e) => setEditState((s) => ({ ...s, color: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="config-edit-actions">
                      <button className="btn-primary" onClick={() => saveEdit(cal.id)}>{t('config.save')}</button>
                      <button className="btn-cancel" onClick={() => setEditingId(null)}>{t('config.cancel')}</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="config-item" key={cal.id}>
                  <div className="config-item-color" style={{ backgroundColor: cal.color }} />
                  <div className="config-item-info">
                    <div className="config-item-name">{cal.name}</div>
                    <div className="config-item-url">
                      {cal.ownerEmail ? `${cal.ownerEmail} · ${cal.url}` : cal.url}
                    </div>
                  </div>
                  <button className="btn-edit" onClick={() => startEdit(cal)} title={t('config.edit')}>
                    <Pencil size={15} />
                  </button>
                  <button className="btn-remove" onClick={() => removeCalendar(cal.id)} title={t('config.delete')}>
                    <Trash2 size={15} />
                  </button>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Nextcloud manage modal ────────────────────────────────────────────────────

interface NextcloudEditState {
  name: string;
  url: string;
  username: string;
  password: string;
  color: string;
}

function NextcloudManageModal({ calendars, onClose }: {
  calendars: CalendarConfig[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { removeCalendar, updateCalendar } = useCalendars();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<NextcloudEditState>({ name: '', url: '', username: '', password: '', color: '' });
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const startEdit = (cal: CalendarConfig) => {
    setEditingId(cal.id);
    setTestResult(null);
    setEditState({
      name: cal.name,
      url: cal.url,
      username: cal.nextcloudUsername ?? '',
      password: cal.nextcloudPassword ?? '',
      color: cal.color,
    });
  };

  const handleChange = (updater: (s: NextcloudEditState) => NextcloudEditState) => {
    setTestResult(null);
    setEditState(updater);
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await testNextcloudConnection(editState.url, editState.username, editState.password);
    setTestResult(result);
    setTesting(false);
  };

  const saveEdit = (id: string) => {
    if (!editState.name.trim() || !editState.url.trim()) return;
    updateCalendar(id, {
      name: editState.name.trim(),
      url: editState.url.trim(),
      color: editState.color,
      nextcloudUsername: editState.username.trim() || undefined,
      nextcloudPassword: editState.password || undefined,
    });
    setEditingId(null);
  };

  return (
    <div
      className="nc-modal-overlay"
      onClick={(e) => { if (editingId === null && e.target === e.currentTarget) onClose(); }}
    >
      <div className="nc-modal-box nc-modal-box--wide">
        <div className="nc-modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Cloud size={16} /> Nextcloud / CalDAV
          </h2>
          <button type="button" className="nc-modal-close" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="nc-modal-body">
          <div className="config-list" style={{ marginBottom: 0 }}>
            {calendars.map((cal) =>
              editingId === cal.id ? (
                <div className="config-item config-item--editing" key={cal.id}>
                  <div className="config-edit-form">
                    <div className="form-row">
                      <label htmlFor={`nc-name-${cal.id}`}>{t('config.nameLabel')}</label>
                      <input
                        id={`nc-name-${cal.id}`}
                        type="text"
                        value={editState.name}
                        onChange={(e) => handleChange((s) => ({ ...s, name: e.target.value }))}
                        autoFocus
                      />
                    </div>
                    <div className="form-row">
                      <label htmlFor={`nc-url-${cal.id}`}>{t('config.caldavUrl')}</label>
                      <input
                        id={`nc-url-${cal.id}`}
                        type="url"
                        placeholder="https://cloud.example.com/remote.php/dav/calendars/…"
                        value={editState.url}
                        onChange={(e) => handleChange((s) => ({ ...s, url: e.target.value }))}
                      />
                    </div>
                    <div className="form-row">
                      <label htmlFor={`nc-user-${cal.id}`}>{t('config.username')}</label>
                      <input
                        id={`nc-user-${cal.id}`}
                        type="text"
                        value={editState.username}
                        onChange={(e) => handleChange((s) => ({ ...s, username: e.target.value }))}
                      />
                    </div>
                    <div className="form-row">
                      <label htmlFor={`nc-pass-${cal.id}`}>{t('config.appPassword')}</label>
                      <input
                        id={`nc-pass-${cal.id}`}
                        type="password"
                        value={editState.password}
                        onChange={(e) => handleChange((s) => ({ ...s, password: e.target.value }))}
                      />
                    </div>
                    <div className="form-row">
                      <label htmlFor={`nc-color-${cal.id}`}>{t('config.colorLabel')}</label>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <ColorSwatches
                          colors={DEFAULT_COLORS}
                          selected={editState.color}
                          onSelect={(c) => handleChange((s) => ({ ...s, color: c }))}
                        />
                        <input
                          id={`nc-color-${cal.id}`}
                          type="color"
                          value={editState.color}
                          onChange={(e) => handleChange((s) => ({ ...s, color: e.target.value }))}
                        />
                      </div>
                    </div>
                    <ConnectionTestRow result={testResult} testing={testing} onTest={runTest} />
                    <div className="config-edit-actions">
                      <button className="btn-primary" onClick={() => saveEdit(cal.id)}>{t('config.save')}</button>
                      <button className="btn-cancel" onClick={() => setEditingId(null)}>{t('config.cancel')}</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="config-item" key={cal.id}>
                  <div className="config-item-color" style={{ backgroundColor: cal.color }} />
                  <div className="config-item-info">
                    <div className="config-item-name">{cal.name}</div>
                    <div className="config-item-url">
                      {cal.nextcloudUsername
                        ? `${cal.nextcloudUsername} · ${cal.nextcloudServerUrl ?? cal.url}`
                        : cal.url}
                    </div>
                  </div>
                  <button className="btn-edit" onClick={() => startEdit(cal)} title={t('config.edit')}>
                    <Pencil size={15} />
                  </button>
                  <button className="btn-remove" onClick={() => removeCalendar(cal.id)} title={t('config.delete')}>
                    <Trash2 size={15} />
                  </button>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Exchange account manage modal ─────────────────────────────────────────────

function ExchangeAccountManageModal({ account, existingCalendars, onClose }: {
  account: ExchangeAccount;
  existingCalendars: CalendarConfig[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { removeAccount, updateAccountCapabilities } = useExchangeAuth();
  const { removeCalendar } = useCalendars();
  const [capabilities, setCapabilities] = useState<('calendar' | 'email')[]>(
    account.enabledCapabilities ?? ['calendar', 'email']
  );

  const handleCapabilityChange = (cap: 'calendar' | 'email', enabled: boolean) => {
    const next = enabled ? [...capabilities, cap] : capabilities.filter((c) => c !== cap);
    setCapabilities(next);
    updateAccountCapabilities(account.id, next);
  };

  const accountCals = existingCalendars.filter(
    (c) => c.type === 'exchange' && c.exchangeAccountId === account.id
  );

  const handleDisconnect = () => {
    accountCals.forEach((c) => removeCalendar(c.id));
    removeAccount(account.id);
    onClose();
  };

  return (
    <div
      className="nc-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="nc-modal-box nc-modal-box--wide">
        <div className="nc-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{account.displayName || account.email}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{account.email}</div>
            </div>
          </div>
          <button type="button" className="nc-modal-close" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="nc-modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 20 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
              {t('config.exchangeConnectedCalendars')}
            </div>
            {accountCals.map((cal) => (
              <div key={cal.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', background: cal.color, flexShrink: 0, display: 'inline-block' }} />
                <span style={{ fontSize: 14 }}>{cal.name}</span>
              </div>
            ))}
          </div>
          {/* Capabilities */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>{t('config.enabledServices')}</div>
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
                  <span style={{ fontSize: 14 }}>{t(`config.cap.${cap}`)}</span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <button
              type="button"
              className="btn-remove"
              onClick={handleDisconnect}
              style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Trash2 size={14} /> {t('config.disconnectAccount')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── New calendar modal ────────────────────────────────────────────────────────

function NewCalendarModal({
  onClose,
  onOpenEventKit,
}: {
  onClose: () => void;
  onOpenEventKit: () => void;
}) {
  const { t } = useTranslation();
  const { addCalendar, calendars } = useCalendars();
  const { connectGoogle, updateAccountCapabilities: updateGoogleCapabilities } = useGoogleAuth();
  const { addAccount } = useExchangeAuth();
  const { addAccount: addImapAccount } = useImapAuth();

  const [step, setStep] = useState<'pick' | 'capabilities' | 'configure' | 'google' | 'exchange' | 'imap'>('pick');
  const [selectedType, setSelectedType] = useState<'ics' | 'nextcloud' | null>(null);
  const [pendingProviderType, setPendingProviderType] = useState<'google' | 'exchange' | null>(null);
  const [pendingCapabilities, setPendingCapabilities] = useState<('calendar' | 'email')[]>(['calendar', 'email']);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');

  // Exchange device code flow state
  const [exUserCode, setExUserCode] = useState('');
  const [exVerifUri, setExVerifUri] = useState('');
  const [exDeviceCode, setExDeviceCode] = useState('');
  const [exInterval, setExInterval] = useState(5);
  const [exPolling, setExPolling] = useState(false);
  const [exCalName, setExCalName] = useState('Exchange Calendar');
  const [exColor, setExColor] = useState('#0078d4');

  // Google OAuth credentials
  const [gcClientId, setGcClientId] = useState(() => getGoogleClientConfig()?.clientId ?? '');
  const [gcClientSecret, setGcClientSecret] = useState(() => getGoogleClientConfig()?.clientSecret ?? '');
  const [gcSaved, setGcSaved] = useState(false);

  // ICS form
  const [icsName, setIcsName] = useState('');
  const [icsUrl, setIcsUrl] = useState('');
  const [icsEmail, setIcsEmail] = useState('');
  const [icsColor, setIcsColor] = useState(() => nextColor(calendars));

  // Nextcloud form
  const [ncName, setNcName] = useState('');
  const [ncServerUrl, setNcServerUrl] = useState('');
  const [ncCalendarUrl, setNcCalendarUrl] = useState('');
  const [ncUsername, setNcUsername] = useState('');
  const [ncPassword, setNcPassword] = useState('');
  const [ncColor, setNcColor] = useState(() => nextColor(calendars));
  const [ncTestResult, setNcTestResult] = useState<TestResult | null>(null);
  const [ncTesting, setNcTesting] = useState(false);

  // IMAP form
  const [imapEmail, setImapEmail] = useState('');
  const [imapDisplayName, setImapDisplayName] = useState('');
  const [imapServer, setImapServer] = useState('');
  const [imapPort, setImapPort] = useState(993);
  const [imapUseSsl, setImapUseSsl] = useState(true);
  const [imapUseStarttls, setImapUseStarttls] = useState(false);
  const [imapUsername, setImapUsername] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [smtpServer, setSmtpServer] = useState('');
  const [smtpPort, setSmtpPort] = useState(465);
  const [smtpUseSsl, setSmtpUseSsl] = useState(true);
  const [smtpUseStarttls, setSmtpUseStarttls] = useState(false);
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [imapColor, setImapColor] = useState(() => nextColor(calendars));

  const handleNcTest = async () => {
    setNcTesting(true);
    setNcTestResult(null);
    const result = await testNextcloudConnection(ncCalendarUrl, ncUsername, ncPassword);
    setNcTestResult(result);
    setNcTesting(false);
  };

  const resetNcTest = () => setNcTestResult(null);

  const handleSaveCredentials = (e: FormEvent) => {
    e.preventDefault();
    if (gcClientId.trim() && gcClientSecret.trim()) {
      setGoogleClientConfig({ clientId: gcClientId.trim(), clientSecret: gcClientSecret.trim() });
    } else {
      clearGoogleClientConfig();
    }
    setGcSaved(true);
    setTimeout(() => setGcSaved(false), 1500);
  };

  const handleConnectGoogle = async () => {
    setConnecting(true);
    setConnectError('');
    const account = await connectGoogle();
    setConnecting(false);
    if (account) {
      updateGoogleCapabilities(account.id, pendingCapabilities);
      onClose();
    } else {
      setConnectError(t('config.googleConnectionError'));
    }
  };

  const handleTypeSelect = (type: 'ics' | 'google' | 'nextcloud' | 'eventkit' | 'exchange' | 'imap') => {
    if (type === 'eventkit') { onOpenEventKit(); return; }
    if (type === 'google' || type === 'exchange') {
      setPendingProviderType(type);
      setPendingCapabilities(['calendar', 'email']);
      setStep('capabilities');
      return;
    }
    if (type === 'imap') {
        setStep('imap');
        return;
    }
    setSelectedType(type);
    setStep('configure');
  };

  const handleCapabilitiesContinue = () => {
    if (pendingProviderType === 'google') setStep('google');
    else if (pendingProviderType === 'exchange') setStep('exchange');
  };

  const startExchangeAuth = async () => {
    setConnecting(true);
    setConnectError('');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const res = await invoke<{ device_code: string; user_code: string; verification_uri: string; interval: number; message: string }>(
        'ews_start_device_auth'
      );
      setExDeviceCode(res.device_code);
      setExUserCode(res.user_code);
      setExVerifUri(res.verification_uri);
      setExInterval(res.interval);
      setExPolling(true);
      invoke('open_url', { url: res.verification_uri }).catch(() => {});
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : t('config.exchangeAuthError'));
    } finally {
      setConnecting(false);
    }
  };

  // Poll for Exchange token once device code is obtained
  useEffect(() => {
    if (!exPolling || !exDeviceCode) return;
    const timer = setInterval(async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const res = await invoke<{ access_token: string; refresh_token?: string; expires_in: number }>(
          'ews_poll_device_token',
          { deviceCode: exDeviceCode }
        );
        clearInterval(timer);
        setExPolling(false);
        const { email, displayName } = parseExchangeToken(res.access_token);
        const account: ExchangeAccount = {
          id: email,
          email,
          displayName,
          accessToken: res.access_token,
          refreshToken: res.refresh_token ?? '',
          expiresAt: Date.now() + res.expires_in * 1000,
          enabledCapabilities: pendingCapabilities,
        };
        addAccount(account);
        if (pendingCapabilities.includes('calendar')) {
          addCalendar({
            name: exCalName.trim() || 'Exchange Calendar',
            url: '',
            color: exColor,
            visible: true,
            type: 'exchange',
            ownerEmail: email,
            exchangeAccountId: email,
          });
        }
        onClose();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'authorization_pending' || msg.includes('authorization_pending')) return;
        clearInterval(timer);
        setExPolling(false);
        setConnectError(msg);
      }
    }, exInterval * 1000);
    return () => clearInterval(timer);
  }, [exPolling, exDeviceCode, exInterval, exCalName, exColor, pendingCapabilities, addAccount, addCalendar, onClose, t]);

  const handleAddICS = (e: FormEvent) => {
    e.preventDefault();
    if (!icsName.trim() || !icsUrl.trim()) return;
    addCalendar({
      name: icsName.trim(),
      url: icsUrl.trim(),
      color: icsColor,
      visible: true,
      ownerEmail: icsEmail.trim() || undefined,
      type: 'ics',
    });
    onClose();
  };

  const handleAddNextcloud = (e: FormEvent) => {
    e.preventDefault();
    if (!ncName.trim() || !ncCalendarUrl.trim()) return;
    addCalendar({
      name: ncName.trim(),
      url: ncCalendarUrl.trim(),
      color: ncColor,
      visible: true,
      type: 'nextcloud',
      nextcloudServerUrl: ncServerUrl.trim() || undefined,
      nextcloudUsername: ncUsername.trim() || undefined,
      nextcloudPassword: ncPassword || undefined,
    });
    onClose();
  };

  const handleAddImap = (e: FormEvent) => {
    e.preventDefault();
    if (!imapEmail.trim() || !imapServer.trim() || !smtpServer.trim()) return;
    addImapAccount({
      id: imapEmail.trim(),
      email: imapEmail.trim(),
      displayName: imapDisplayName.trim() || imapEmail.trim(),
      imapServer: imapServer.trim(),
      imapPort,
      imapUseSsl,
      imapUseStarttls,
      imapUsername: imapUsername.trim(),
      imapPassword,
      smtpServer: smtpServer.trim(),
      smtpPort,
      smtpUseSsl,
      smtpUseStarttls,
      smtpUsername: smtpUsername.trim(),
      smtpPassword,
      color: imapColor,
    });
    onClose();
  };

  const typeCards: { type: 'ics' | 'google' | 'nextcloud' | 'eventkit' | 'exchange' | 'imap'; icon: React.ReactNode; label: string; desc: string; caps: ('calendar' | 'email')[] }[] = [
    {
      type: 'eventkit',
      icon: <Laptop size={28} />,
      label: t('config.macosCalendar'),
      desc: t('config.macosCalendarDesc'),
      caps: ['calendar'],
    },
    {
      type: 'ics',
      icon: <Rss size={28} />,
      label: 'ICS / iCal',
      desc: t('config.icsFluxDesc'),
      caps: ['calendar'],
    },
    {
      type: 'google',
      icon: (
        <svg width="28" height="28" viewBox="0 0 18 18" aria-hidden="true">
          <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
          <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
          <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
          <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"/>
        </svg>
      ),
      label: t('config.googleAgenda'),
      desc: t('config.googleDesc'),
      caps: ['calendar', 'email'],
    },
    {
      type: 'nextcloud',
      icon: <Cloud size={28} />,
      label: 'Nextcloud',
      desc: t('config.nextcloudCalDAV'),
      caps: ['calendar'],
    },
    {
      type: 'exchange',
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect width="24" height="24" rx="4" fill="#0078d4"/>
          <text x="12" y="17" textAnchor="middle" fontSize="13" fontWeight="bold" fill="white" fontFamily="sans-serif">Ex</text>
        </svg>
      ),
      label: 'Exchange / Office 365',
      desc: t('config.exchangeDesc'),
      caps: ['calendar', 'email'],
    },
    {
      type: 'imap',
      icon: <Mail size={28} />,
      label: 'IMAP / SMTP',
      desc: t('config.imapDesc', 'Generic IMAP/SMTP account'),
      caps: ['email'],
    },
  ];

  const modalTitle = step === 'pick'
    ? t('config.connectProvider')
    : step === 'capabilities'
      ? t('config.chooseServices')
      : step === 'google'
        ? t('config.googleAgenda')
        : step === 'exchange'
          ? 'Exchange / Office 365'
        : step === 'imap'
          ? 'IMAP / SMTP'
          : selectedType === 'ics'
            ? t('config.addICSCalendar')
            : t('config.addNextcloudCalendar');

  return (
    <div
      className="nc-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`nc-modal-box ${step === 'pick' ? 'nc-modal-box--narrow' : 'nc-modal-box--wide'}`}>
        <div className="nc-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {step !== 'pick' && !exPolling && (
              <button
                type="button"
                className="nc-modal-back"
                onClick={() => {
                  if (step === 'capabilities') { setStep('pick'); setPendingProviderType(null); return; }
                  if (step === 'google' || step === 'exchange') { setStep('capabilities'); setConnectError(''); return; }
                  setStep('pick'); setSelectedType(null); setConnectError(''); setExUserCode(''); setExDeviceCode(''); setExPolling(false);
                }}
                title={t('config.back')}
              >
                ←
              </button>
            )}
            <h2>{modalTitle}</h2>
          </div>
          <button type="button" className="nc-modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="nc-modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {/* Step 1: pick type */}
          {step === 'pick' && (
            <>
              <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--text-muted)' }}>
                {t('config.chooseProviderType')}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {typeCards.map(({ type, icon, label, desc, caps }) => (
                  <button
                    key={type}
                    type="button"
                    className="calendar-type-card"
                    onClick={() => handleTypeSelect(type)}
                  >
                    <span className="calendar-type-card-icon">{icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="calendar-type-card-label">{label}</div>
                      <div className="calendar-type-card-desc">{desc}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      {caps.map((cap) => <CapBadge key={cap} cap={cap} />)}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Step: capabilities selection */}
          {step === 'capabilities' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>
                {t('config.chooseServicesDesc')}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(['calendar', 'email'] as const).map((cap) => (
                  <label
                    key={cap}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}
                  >
                    <input
                      type="checkbox"
                      checked={pendingCapabilities.includes(cap)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setPendingCapabilities((prev) => [...prev, cap]);
                        } else {
                          setPendingCapabilities((prev) => prev.filter((c) => c !== cap));
                        }
                      }}
                    />
                    <CapBadge cap={cap} />
                    <span style={{ fontSize: 14 }}>{t(`config.cap.${cap}`)}</span>
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="btn-primary"
                onClick={handleCapabilitiesContinue}
                disabled={pendingCapabilities.length === 0}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                {t('config.continue')}
              </button>
            </div>
          )}

          {/* Step: Google */}
          {step === 'google' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {t('config.oauthDescription')}
              </p>
              <form onSubmit={handleSaveCredentials} className="config-form">
                <div className="form-row">
                  <label htmlFor="new-gc-client-id">Client ID</label>
                  <input
                    id="new-gc-client-id"
                    type="text"
                    placeholder="123456789-abc…apps.googleusercontent.com"
                    value={gcClientId}
                    onChange={(e) => setGcClientId(e.target.value)}
                  />
                </div>
                <div className="form-row">
                  <label htmlFor="new-gc-client-secret">Client Secret</label>
                  <input
                    id="new-gc-client-secret"
                    type="password"
                    placeholder="GOCSPX-…"
                    value={gcClientSecret}
                    onChange={(e) => setGcClientSecret(e.target.value)}
                  />
                </div>
                <div className="form-actions" style={{ alignItems: 'center', gap: 12 }}>
                  <button type="submit" className="btn-cancel">{t('config.save')}</button>
                  {gcSaved && (
                    <span style={{ fontSize: 13, color: 'var(--color-success, #34a853)' }}>
                      {t('config.savedConfirmation')}
                    </span>
                  )}
                </div>
              </form>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleConnectGoogle}
                  disabled={connecting}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  {connecting ? t('config.connectingGoogle') : t('config.connectGoogleAccount')}
                </button>
                {connectError && (
                  <div style={{ marginTop: 10, fontSize: 13, color: 'var(--color-error, #d93025)' }}>
                    {connectError}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Exchange device code flow */}
          {step === 'exchange' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-row">
                <label htmlFor="exchange-cal-name">{t('config.nameLabel')}</label>
                <input
                  id="exchange-cal-name"
                  type="text"
                  value={exCalName}
                  onChange={(e) => setExCalName(e.target.value)}
                  placeholder="Exchange Calendar"
                />
              </div>
              <div className="form-row">
                <label htmlFor="exchange-cal-color">{t('config.colorLabel')}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <ColorSwatches colors={DEFAULT_COLORS} selected={exColor} onSelect={setExColor} />
                  <input id="exchange-cal-color" type="color" value={exColor} onChange={(e) => setExColor(e.target.value)} />
                </div>
              </div>
              {!exUserCode && !exPolling && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={startExchangeAuth}
                  disabled={connecting}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  {connecting ? t('config.connecting') : t('config.exchangeStartAuth')}
                </button>
              )}
              {exUserCode && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <p style={{ margin: 0, fontSize: 14 }}>{t('config.exchangeEnterCode')}</p>
                  <div style={{
                    fontSize: 28, fontWeight: 700, letterSpacing: 4,
                    textAlign: 'center', padding: '12px 20px',
                    background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8,
                    border: '1px solid var(--border)', fontFamily: 'monospace',
                  }}>
                    {exUserCode}
                  </div>
                  <button
                    type="button"
                    className="btn-edit"
                    onClick={() => { import('@tauri-apps/api/core').then(({ invoke }) => invoke('open_url', { url: exVerifUri })); }}
                    style={{ fontSize: 13 }}
                  >
                    {t('config.exchangeOpenBrowser')} ↗
                  </button>
                  {exPolling && (
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
                      {t('config.exchangeWaiting')}
                    </p>
                  )}
                </div>
              )}
              {connectError && (
                <div style={{ fontSize: 13, color: 'var(--color-error, #d93025)' }}>{connectError}</div>
              )}
            </div>
          )}

          {/* Step: IMAP form */}
          {step === 'imap' && (
            <form onSubmit={handleAddImap} className="config-form">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div>
                  <h3 style={{ fontSize: 14, marginBottom: 12 }}>{t('config.generalInfo', 'General')}</h3>
                  <div className="form-row">
                    <label>{t('config.email', 'Email')}</label>
                    <input type="email" value={imapEmail} onChange={(e) => setImapEmail(e.target.value)} required />
                  </div>
                  <div className="form-row">
                    <label>{t('config.displayName', 'Display Name')}</label>
                    <input type="text" value={imapDisplayName} onChange={(e) => setImapDisplayName(e.target.value)} />
                  </div>
                </div>
                <div>
                  <h3 style={{ fontSize: 14, marginBottom: 12 }}>{t('config.accountColor', 'Color')}</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <ColorSwatches colors={DEFAULT_COLORS} selected={imapColor} onSelect={setImapColor} />
                    <input type="color" value={imapColor} onChange={(e) => setImapColor(e.target.value)} />
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 20 }}>
                <div>
                  <h3 style={{ fontSize: 14, marginBottom: 12 }}>IMAP (Incoming)</h3>
                  <div className="form-row">
                    <label>{t('config.server', 'Server')}</label>
                    <input type="text" value={imapServer} onChange={(e) => setImapServer(e.target.value)} required />
                  </div>
                  <div className="form-row">
                    <label>{t('config.port', 'Port')}</label>
                    <input type="number" value={imapPort} onChange={(e) => setImapPort(Number(e.target.value))} required />
                  </div>
                  <div className="form-row--inline" style={{ display: 'flex', gap: 15, margin: '8px 0' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={imapUseSsl} onChange={(e) => { setImapUseSsl(e.target.checked); if (e.target.checked) setImapUseStarttls(false); }} />
                      SSL / TLS
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={imapUseStarttls} onChange={(e) => { setImapUseStarttls(e.target.checked); if (e.target.checked) setImapUseSsl(false); }} />
                      STARTTLS
                    </label>
                  </div>
                  <div className="form-row">
                    <label>{t('config.username', 'Username')}</label>
                    <input type="text" value={imapUsername} onChange={(e) => setImapUsername(e.target.value)} required />
                  </div>
                  <div className="form-row">
                    <label>{t('config.password', 'Password')}</label>
                    <input type="password" value={imapPassword} onChange={(e) => setImapPassword(e.target.value)} required />
                  </div>
                </div>

                <div>
                  <h3 style={{ fontSize: 14, marginBottom: 12 }}>SMTP (Outgoing)</h3>
                  <div className="form-row">
                    <label>{t('config.server', 'Server')}</label>
                    <input type="text" value={smtpServer} onChange={(e) => setSmtpServer(e.target.value)} required />
                  </div>
                  <div className="form-row">
                    <label>{t('config.port', 'Port')}</label>
                    <input type="number" value={smtpPort} onChange={(e) => setSmtpPort(Number(e.target.value))} required />
                  </div>
                  <div className="form-row--inline" style={{ display: 'flex', gap: 15, margin: '8px 0' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={smtpUseSsl} onChange={(e) => { setSmtpUseSsl(e.target.checked); if (e.target.checked) setSmtpUseStarttls(false); }} />
                      SSL / TLS
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={smtpUseStarttls} onChange={(e) => { setSmtpUseStarttls(e.target.checked); if (e.target.checked) setSmtpUseSsl(false); }} />
                      STARTTLS
                    </label>
                  </div>
                  <div className="form-row">
                    <label>{t('config.username', 'Username')}</label>
                    <input type="text" value={smtpUsername} onChange={(e) => setSmtpUsername(e.target.value)} required />
                  </div>
                  <div className="form-row">
                    <label>{t('config.password', 'Password')}</label>
                    <input type="password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} required />
                  </div>
                </div>
              </div>

              <div className="form-actions" style={{ marginTop: 24 }}>
                <button type="submit" className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                  {t('config.add', 'Ajouter')}
                </button>
                <button type="button" className="btn-cancel" onClick={onClose}>
                  {t('config.cancel', 'Annuler')}
                </button>
              </div>
            </form>
          )}

          {/* Step 2: ICS form */}
          {step === 'configure' && selectedType === 'ics' && (
            <form onSubmit={handleAddICS} className="config-form">
              <div className="form-row">
                <label htmlFor="modal-ics-name">{t('config.nameLabel')}</label>
                <input
                  id="modal-ics-name"
                  type="text"
                  placeholder={t('config.icsCalendarNamePlaceholder')}
                  value={icsName}
                  onChange={(e) => setIcsName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="form-row">
                <label htmlFor="modal-ics-url">{t('config.icsUrl')}</label>
                <input
                  id="modal-ics-url"
                  type="url"
                  placeholder="https://calendar.google.com/…/basic.ics"
                  value={icsUrl}
                  onChange={(e) => setIcsUrl(e.target.value)}
                  required
                />
              </div>
              <div className="form-row">
                <label htmlFor="modal-ics-email">
                  {t('config.myEmail')}{' '}
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>{t('config.optional')}</span>
                </label>
                <input
                  id="modal-ics-email"
                  type="email"
                  placeholder="moi@example.com"
                  value={icsEmail}
                  onChange={(e) => setIcsEmail(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label htmlFor="modal-ics-color">{t('config.colorLabel')}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <ColorSwatches colors={DEFAULT_COLORS} selected={icsColor} onSelect={setIcsColor} />
                  <input id="modal-ics-color" type="color" value={icsColor} onChange={(e) => setIcsColor(e.target.value)} />
                </div>
              </div>
              <div className="form-actions" style={{ marginTop: 20 }}>
                <button type="submit" className="btn-primary" disabled={!icsName.trim() || !icsUrl.trim()}>
                  {t('config.add')}
                </button>
                <button type="button" className="btn-cancel" onClick={onClose}>
                  {t('config.cancel')}
                </button>
              </div>
            </form>
          )}

          {/* Step 2: Nextcloud form */}
          {step === 'configure' && selectedType === 'nextcloud' && (
            <form onSubmit={handleAddNextcloud} className="config-form">
              <div className="form-row">
                <label htmlFor="modal-nc-name">{t('config.displayedName')}</label>
                <input
                  id="modal-nc-name"
                  type="text"
                  placeholder={t('config.personalCalendarPlaceholder')}
                  value={ncName}
                  onChange={(e) => setNcName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="form-row">
                <label htmlFor="modal-nc-server">{t('config.nextcloudServerUrl')}</label>
                <input
                  id="modal-nc-server"
                  type="url"
                  placeholder="https://cloud.example.com"
                  value={ncServerUrl}
                  onChange={(e) => setNcServerUrl(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label htmlFor="modal-nc-cal-url">{t('config.caldavCalendarUrl')}</label>
                <input
                  id="modal-nc-cal-url"
                  type="url"
                  placeholder="https://cloud.example.com/remote.php/dav/calendars/user/personal/"
                  value={ncCalendarUrl}
                  onChange={(e) => { setNcCalendarUrl(e.target.value); resetNcTest(); }}
                  required
                />
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {t('config.caldavHelp')}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="modal-nc-user">{t('config.username')}</label>
                <input
                  id="modal-nc-user"
                  type="text"
                  value={ncUsername}
                  onChange={(e) => { setNcUsername(e.target.value); resetNcTest(); }}
                />
              </div>
              <div className="form-row">
                <label htmlFor="modal-nc-pass">{t('config.appPassword')}</label>
                <input
                  id="modal-nc-pass"
                  type="password"
                  placeholder={t('config.appPasswordHelp')}
                  value={ncPassword}
                  onChange={(e) => { setNcPassword(e.target.value); resetNcTest(); }}
                />
              </div>
              <div className="form-row">
                <label htmlFor="modal-nc-color">{t('config.colorLabel')}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <ColorSwatches colors={DEFAULT_COLORS} selected={ncColor} onSelect={setNcColor} />
                  <input id="modal-nc-color" type="color" value={ncColor} onChange={(e) => setNcColor(e.target.value)} />
                </div>
              </div>
              <ConnectionTestRow result={ncTestResult} testing={ncTesting} onTest={handleNcTest} />
              <div className="form-actions" style={{ marginTop: 12 }}>
                <button type="submit" className="btn-primary" disabled={!ncName.trim() || !ncCalendarUrl.trim()}>
                  {t('config.add')}
                </button>
                <button type="button" className="btn-cancel" onClick={onClose}>
                  {t('config.cancel')}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Settings section ──────────────────────────────────────────────────────────

function SettingsSection() {
  const { t } = useTranslation();
  const { preference, setPreference } = useLanguage();
  const { layout, setLayout } = useLayout();
  const { preference: themePref, setPreference: setThemePref } = useTheme();

  const langOptions: { value: LanguagePreference; label: string; flag: string }[] = [
    { value: 'system', label: t('settings.language.system'), flag: '🖥' },
    { value: 'fr', label: t('settings.language.fr'), flag: '🇫🇷' },
    { value: 'en', label: t('settings.language.en'), flag: '🇬🇧' },
  ];

  const themeOptions: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
    { value: 'system', label: t('settings.theme.system'), icon: <Monitor size={15} /> },
    { value: 'light', label: t('settings.theme.light'), icon: <Sun size={15} /> },
    { value: 'dark', label: t('settings.theme.dark'), icon: <Moon size={15} /> },
  ];

  const layoutOptions: { value: AppLayout; label: string; icon: React.ReactNode }[] = [
    { value: 'tabbed', label: t('settings.layout.tabbed', 'Onglets'), icon: <LayoutPanelTop size={15} /> },
    { value: 'windows', label: t('settings.layout.windows', 'Fenêtres séparées'), icon: <Columns2 size={15} /> },
  ];

  const segmentStyle = {
    display: 'inline-flex' as const,
    border: '1px solid var(--border)',
    borderRadius: 8,
    overflow: 'hidden' as const,
    background: 'var(--bg-secondary, var(--bg))',
  };

  const btnStyle = (active: boolean, isFirst: boolean) => ({
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 7,
    padding: '8px 16px',
    border: 'none',
    borderLeft: isFirst ? 'none' : '1px solid var(--border)',
    background: active ? 'var(--color-primary, #1a73e8)' : 'transparent',
    color: active ? '#fff' : 'var(--text)',
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    fontSize: 14,
    transition: 'background 0.15s, color 0.15s',
  });

  return (
    <div style={{ maxWidth: 480 }}>

      {/* Langue */}
      <div style={{ marginBottom: 28 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Languages size={16} />
          {t('settings.language.sectionTitle')}
        </h3>
        <div style={segmentStyle}>
          {langOptions.map((opt, i) => (
            <button key={opt.value} type="button" onClick={() => setPreference(opt.value)} style={btnStyle(preference === opt.value, i === 0)}>
              <span style={{ fontSize: 16, lineHeight: 1 }}>{opt.flag}</span>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Thème */}
      <div style={{ marginBottom: 28 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sun size={16} />
          {t('settings.theme.sectionTitle')}
        </h3>
        <div style={segmentStyle}>
          {themeOptions.map((opt, i) => (
            <button key={opt.value} type="button" onClick={() => setThemePref(opt.value)} style={btnStyle(themePref === opt.value, i === 0)}>
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Layout */}
      <div style={{ marginBottom: 28 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <LayoutPanelTop size={16} />
          {t('settings.layout.sectionTitle', 'Interface')}
        </h3>
        <div style={segmentStyle}>
          {layoutOptions.map((opt, i) => (
            <button key={opt.value} type="button" onClick={() => setLayout(opt.value)} style={btnStyle(layout === opt.value, i === 0)}>
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted, var(--text))', opacity: 0.6 }}>
          {t('settings.layout.hint', 'Redémarrez l\'application pour appliquer le mode Fenêtres séparées.')}
        </p>
      </div>

    </div>
  );
}

// ── Edit modal state ──────────────────────────────────────────────────────────

type EditModalState =
  | { type: 'eventkit' }
  | { type: 'google'; accountId: string }
  | { type: 'exchange'; accountId: string }
  | { type: 'imap'; accountId: string }
  | { type: 'ics' }
  | { type: 'nextcloud' }
  | null;

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ConfigPage() {
  const { t } = useTranslation();
  const { calendars } = useCalendars();
  const { accounts, updateAccountColor: updateGoogleColor } = useGoogleAuth();
  const { accounts: exchangeAccounts, updateAccountColor: updateExchangeColor } = useExchangeAuth();
  const { accounts: imapAccounts, updateAccountColor: updateImapColor, removeAccount: removeImapAccount, updateAccount: updateImapAccount } = useImapAuth();
  const { defaultCalendarId, setDefaultCalendar } = useDefaultCalendar();

  const [activeSection, setActiveSection] = useState<SectionType>('providers');
  const [showNewCalModal, setShowNewCalModal] = useState(false);
  const [editModal, setEditModal] = useState<EditModalState>(null);

  const ekCals = calendars.filter((c) => c.type === 'eventkit');
  const icsCals = calendars.filter((c) => !c.type || c.type === 'ics');
  const nextcloudCals = calendars.filter((c) => c.type === 'nextcloud');

  const googleGroups = accounts.map((account) => ({
    account,
    cals: calendars.filter((c) => c.type === 'google' && c.googleAccountId === account.id),
  }));

  const exchangeGroups = exchangeAccounts.map((account) => ({
    account,
    cals: calendars.filter((c) => c.type === 'exchange' && c.exchangeAccountId === account.id),
  }));

  const hasAnyProvider =
    ekCals.length > 0 ||
    accounts.length > 0 ||
    exchangeAccounts.length > 0 ||
    imapAccounts.length > 0 ||
    icsCals.length > 0 ||
    nextcloudCals.length > 0;

  const sections: { id: SectionType; label: string; icon: React.ReactNode }[] = [
    { id: 'providers', label: t('config.sectProviders'), icon: <SlidersHorizontal size={15} /> },
    { id: 'preferences', label: t('config.sectPreferences'), icon: <Languages size={15} /> },
  ];

  const openEventKit = () => {
    setShowNewCalModal(false);
    setEditModal({ type: 'eventkit' });
  };

  const editingAccount = editModal?.type === 'google'
    ? accounts.find((a) => a.id === (editModal as { type: 'google'; accountId: string }).accountId)
    : undefined;

  return (
    <div className="app">
      <header className="header">
        <Link to="/" className="btn-config">{t('config.backToCalendar')}</Link>
        <span style={{ fontSize: 18, fontWeight: 400 }}>{t('config.pageTitle')}</span>
      </header>

      <div className="app-body">
        <div className="config-layout">

          {/* ── Sidebar ── */}
          <nav className="config-sidebar">
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`config-sidebar-item${activeSection === s.id ? ' config-sidebar-item--active' : ''}`}
                onClick={() => setActiveSection(s.id)}
              >
                {s.icon}
                {s.label}
              </button>
            ))}
          </nav>

          {/* ── Content ── */}
          <div className="config-content">

            {activeSection === 'providers' && (
              <>
                <div className="config-section-header">
                  <h2 className="config-section-title">{t('config.sectProviders')}</h2>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => setShowNewCalModal(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <Plus size={15} />
                    {t('config.connectProvider')}
                  </button>
                </div>

                {!hasAnyProvider && (
                  <div className="empty-state" style={{ marginTop: 32 }}>
                    {t('config.noProvidersConfigured')}
                  </div>
                )}

                {/* macOS / EventKit */}
                {ekCals.length > 0 && (
                  <GroupSection
                    title="macOS"
                    icon={<Laptop size={13} />}
                    onEdit={() => setEditModal({ type: 'eventkit' })}
                    caps={['calendar']}
                  >
                    {ekCals.map((cal) => <CalendarItem key={cal.id} cal={cal} isDefault={defaultCalendarId === cal.id} onSetDefault={() => setDefaultCalendar(cal.id)} />)}
                  </GroupSection>
                )}

                {/* Google — one group per account (shown even with no calendars) */}
                {googleGroups.map(({ account, cals }) => (
                  <GroupSection
                    key={account.id}
                    title={account.email}
                    icon={
                      account.picture
                        ? <img src={account.picture} alt="" style={{ width: 14, height: 14, borderRadius: '50%' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        : (
                          <svg width="13" height="13" viewBox="0 0 18 18" aria-hidden="true">
                            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
                            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
                            <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
                            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"/>
                          </svg>
                        )
                    }
                    onEdit={() => setEditModal({ type: 'google', accountId: account.id })}
                    caps={account.enabledCapabilities ?? ['calendar', 'email']}
                    color={account.color}
                    onColorChange={(c) => updateGoogleColor(account.id, c)}
                  >
                    {cals.length > 0
                      ? cals.map((cal) => <CalendarItem key={cal.id} cal={cal} isDefault={defaultCalendarId === cal.id} onSetDefault={() => setDefaultCalendar(cal.id)} />)
                      : <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '2px 0' }}>{t('config.noCalendarsLinked')}</div>
                    }
                  </GroupSection>
                ))}

                {/* Exchange — one group per account */}
                {exchangeGroups.map(({ account, cals }) => (
                    <GroupSection
                      key={account.id}
                      title={account.email}
                      icon={
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <rect width="24" height="24" rx="4" fill="#0078d4"/>
                          <text x="12" y="17" textAnchor="middle" fontSize="13" fontWeight="bold" fill="white" fontFamily="sans-serif">Ex</text>
                        </svg>
                      }
                      onEdit={() => setEditModal({ type: 'exchange', accountId: account.id })}
                      caps={account.enabledCapabilities ?? ['calendar', 'email']}
                      color={account.color}
                      onColorChange={(c) => updateExchangeColor(account.id, c)}
                    >
                      {cals.length > 0
                        ? cals.map((cal) => <CalendarItem key={cal.id} cal={cal} isDefault={defaultCalendarId === cal.id} onSetDefault={() => setDefaultCalendar(cal.id)} />)
                        : <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '2px 0' }}>{t('config.noCalendarsLinked')}</div>
                      }
                    </GroupSection>
                  )
                )}

                {/* IMAP */}
                {imapAccounts.map((account) => (
                  <GroupSection
                    key={account.id}
                    title={account.email}
                    icon={<Mail size={13} />}
                    onEdit={() => setEditModal({ type: 'imap', accountId: account.id })}
                    caps={['email']}
                    color={account.color}
                    onColorChange={(c) => updateImapColor(account.id, c)}
                  >
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '2px 0' }}>
                      {account.imapServer}
                    </div>
                  </GroupSection>
                ))}

                {/* ICS */}
                {icsCals.length > 0 && (
                  <GroupSection
                    title="ICS / iCal"
                    icon={<Rss size={13} />}
                    onEdit={() => setEditModal({ type: 'ics' })}
                    caps={['calendar']}
                  >
                    {icsCals.map((cal) => <CalendarItem key={cal.id} cal={cal} isDefault={defaultCalendarId === cal.id} onSetDefault={() => setDefaultCalendar(cal.id)} />)}
                  </GroupSection>
                )}

                {/* Nextcloud */}
                {nextcloudCals.length > 0 && (
                  <GroupSection
                    title="Nextcloud / CalDAV"
                    icon={<Cloud size={13} />}
                    onEdit={() => setEditModal({ type: 'nextcloud' })}
                    caps={['calendar']}
                  >
                    {nextcloudCals.map((cal) => <CalendarItem key={cal.id} cal={cal} isDefault={defaultCalendarId === cal.id} onSetDefault={() => setDefaultCalendar(cal.id)} />)}
                  </GroupSection>
                )}
              </>
            )}

            {activeSection === 'preferences' && (
              <>
                <div className="config-section-header">
                  <h2 className="config-section-title">{t('config.sectPreferences')}</h2>
                </div>
                <SettingsSection />
              </>
            )}

          </div>
        </div>
      </div>

      {/* ── Modals ── */}
      {showNewCalModal && (
        <NewCalendarModal
          onClose={() => setShowNewCalModal(false)}
          onOpenEventKit={openEventKit}
        />
      )}
      {editModal?.type === 'eventkit' && (
        <EventKitManageModal
          existingCalendars={calendars}
          onClose={() => setEditModal(null)}
        />
      )}
      {editModal?.type === 'google' && editingAccount && (
        <GoogleAccountManageModal
          account={editingAccount}
          existingCalendars={calendars}
          onClose={() => setEditModal(null)}
        />
      )}
      {editModal?.type === 'exchange' && (() => {
        const acc = exchangeAccounts.find((a) => a.id === (editModal as { type: 'exchange'; accountId: string }).accountId);
        return acc ? (
          <ExchangeAccountManageModal
            account={acc}
            existingCalendars={calendars}
            onClose={() => setEditModal(null)}
          />
        ) : null;
      })()}
      {editModal?.type === 'imap' && (() => {
        const acc = imapAccounts.find((a) => a.id === (editModal as { type: 'imap'; accountId: string }).accountId);
        return acc ? (
          <ImapAccountManageModal
            account={acc}
            onClose={() => setEditModal(null)}
          />
        ) : null;
      })()}
      {editModal?.type === 'ics' && (
        <ICSManageModal
          calendars={icsCals}
          onClose={() => setEditModal(null)}
        />
      )}
      {editModal?.type === 'nextcloud' && (
        <NextcloudManageModal
          calendars={nextcloudCals}
          onClose={() => setEditModal(null)}
        />
      )}
    </div>
  );
}
