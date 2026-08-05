import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Mail, Settings2, Star } from 'lucide-react';
import i18n from '../../i18n';
import { CalendarConfig } from '../../shared/types';

// ── Connection test result ─────────────────────────────────────────────────────

export interface TestResult {
  ok: boolean;
  message: string;
}

// ── CalDAV connection test ─────────────────────────────────────────────────────

export async function testNextcloudConnection(url: string, username: string, password: string): Promise<TestResult> {
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

// ── Constants ──────────────────────────────────────────────────────────────────

export const DEFAULT_COLORS = [
  '#1a73e8', '#34a853', '#ea4335', '#fbbc04',
  '#9c27b0', '#00bcd4', '#ff5722', '#607d8b',
];

export function nextColor(calendars: CalendarConfig[]) {
  return DEFAULT_COLORS[calendars.length % DEFAULT_COLORS.length];
}

// ── Capability badge ───────────────────────────────────────────────────────────

export function CapBadge({ cap }: { cap: 'calendar' | 'email' }) {
  const { t } = useTranslation();
  const isCalendar = cap === 'calendar';
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      padding: '2px 6px',
      borderRadius: 4,
      fontSize: 'calc(10px * var(--font-scale, 1))',
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

// ── Color swatches ─────────────────────────────────────────────────────────────

export function ColorSwatches({ colors, selected, onSelect }: {
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

// ── Unified calendar item ──────────────────────────────────────────────────────

export function CalendarItem({ cal, isDefault, onSetDefault }: {
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

// ── Group section with hover edit icon ─────────────────────────────────────────

export function GroupSection({
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

// ── Connection test row ────────────────────────────────────────────────────────

export function ConnectionTestRow({ result, testing, onTest }: {
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
        style={{ fontSize: 'calc(13px * var(--font-scale, 1))', gap: 6, whiteSpace: 'nowrap' }}
      >
        {testing ? t('config.testing') : t('config.testConnectionBtn')}
      </button>
      {result && (
        <span style={{
          fontSize: 'calc(13px * var(--font-scale, 1))',
          color: result.ok ? 'var(--color-success, #34a853)' : 'var(--color-error, #d93025)',
        }}>
          {result.ok ? '✓ ' : '✗ '}{result.message}
        </span>
      )}
    </div>
  );
}
