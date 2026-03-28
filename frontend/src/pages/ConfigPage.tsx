import { useState, useEffect, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Laptop, Globe, Rss, Pencil, Trash2, CalendarDays, Cloud, Plus, X } from 'lucide-react';
// ── CalDAV connection test ────────────────────────────────────────────────────

interface TestResult {
  ok: boolean;
  message: string;
}

async function testNextcloudConnection(url: string, username: string, password: string): Promise<TestResult> {
  if (!url.trim()) return { ok: false, message: "L'URL CalDAV est requise." };
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const status = await invoke<number>('fetch_caldav_status', { url: url.trim(), username: username.trim(), password });
    if (status === 200 || status === 207) return { ok: true, message: 'Connexion réussie.' };
    if (status === 401) return { ok: false, message: 'Identifiants incorrects (401 Unauthorized).' };
    if (status === 403) return { ok: false, message: 'Accès refusé (403 Forbidden).' };
    if (status === 404) return { ok: false, message: 'URL introuvable — vérifiez le chemin CalDAV (404).' };
    return { ok: false, message: `Réponse inattendue du serveur (HTTP ${status}).` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Erreur inconnue.' };
  }
}

import { useCalendars } from '../store/CalendarStore';
import { useGoogleAuth } from '../store/GoogleAuthStore';
import { getGoogleClientConfig, setGoogleClientConfig, clearGoogleClientConfig } from '../store/googleClientConfig';
import { listCalendars } from '../utils/googleCalendarApi';
import { CalendarConfig, GoogleAccount } from '../types';

const DEFAULT_COLORS = [
  '#1a73e8', '#34a853', '#ea4335', '#fbbc04',
  '#9c27b0', '#00bcd4', '#ff5722', '#607d8b',
];

function nextColor(calendars: CalendarConfig[]) {
  return DEFAULT_COLORS[calendars.length % DEFAULT_COLORS.length];
}

interface ICSEditState {
  name: string;
  url: string;
  color: string;
  ownerEmail: string;
}

interface NextcloudEditState {
  name: string;
  url: string;
  username: string;
  password: string;
  color: string;
}

type TabType = 'ics' | 'google' | 'nextcloud' | 'eventkit';

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

// ── Google calendar picker ────────────────────────────────────────────────────

interface GoogleCalEntry {
  id: string;
  summary: string;
  backgroundColor?: string;
  accessRole: string;
  primary?: boolean;
}

function GoogleAccountSection({
  account,
  existingCalendars,
}: {
  account: GoogleAccount;
  existingCalendars: CalendarConfig[];
}) {
  const { removeAccount, getValidToken } = useGoogleAuth();
  const { addCalendar, removeCalendar } = useCalendars();
  const [gCals, setGCals] = useState<GoogleCalEntry[] | null>(null);
  const [loadingCals, setLoadingCals] = useState(false);
  const [calError, setCalError] = useState('');

  const connectedIds = new Set(
    existingCalendars
      .filter((c) => c.type === 'google' && c.googleAccountId === account.id)
      .map((c) => c.googleCalendarId)
  );

  const loadCalendars = async () => {
    setLoadingCals(true);
    setCalError('');
    try {
      const token = await getValidToken(account.id);
      if (!token) throw new Error('Token invalide. Reconnectez le compte.');
      const items = await listCalendars(token);
      setGCals(items as GoogleCalEntry[]);
    } catch (err) {
      setCalError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoadingCals(false);
    }
  };

  const toggleCalendar = (gCal: GoogleCalEntry) => {
    const existing = existingCalendars.find(
      (c) => c.type === 'google' && c.googleCalendarId === gCal.id && c.googleAccountId === account.id
    );
    if (existing) {
      removeCalendar(existing.id);
    } else {
      const colorIndex = existingCalendars.length % DEFAULT_COLORS.length;
      addCalendar({
        name: gCal.summary,
        url: '',
        color: gCal.backgroundColor ?? DEFAULT_COLORS[colorIndex],
        visible: true,
        ownerEmail: account.email,
        type: 'google',
        googleCalendarId: gCal.id,
        googleAccountId: account.id,
      });
    }
  };

  return (
    <div className="config-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
        {account.picture && (
          <img
            src={account.picture}
            alt={account.name}
            style={{ width: 32, height: 32, borderRadius: '50%' }}
          />
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500 }}>{account.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{account.email}</div>
        </div>
        <button
          type="button"
          className="btn-edit"
          onClick={loadCalendars}
          disabled={loadingCals}
          title="Choisir les calendriers"
          style={{ fontSize: 13, gap: 6 }}
        >
          <CalendarDays size={14} />
          {loadingCals ? '…' : 'Calendriers'}
        </button>
        <button
          type="button"
          className="btn-remove"
          onClick={() => removeAccount(account.id)}
          title="Déconnecter ce compte"
        >
          <Trash2 size={15} />
        </button>
      </div>

      {calError && <div style={{ color: 'var(--color-error, #d93025)', fontSize: 13 }}>{calError}</div>}

      {gCals && (
        <div style={{ width: '100%', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            Sélectionnez les calendriers à afficher :
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {gCals.map((gCal) => {
              const isAdded = connectedIds.has(gCal.id);
              return (
                <label
                  key={gCal.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14 }}
                >
                  <input
                    type="checkbox"
                    checked={isAdded}
                    onChange={() => toggleCalendar(gCal)}
                  />
                  <span
                    style={{
                      width: 12, height: 12, borderRadius: '50%',
                      background: gCal.backgroundColor ?? '#888',
                      flexShrink: 0,
                    }}
                  />
                  <span>{gCal.summary}{gCal.primary ? ' (principal)' : ''}</span>
                  {gCal.accessRole === 'reader' && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>lecture seule</span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── EventKit section ──────────────────────────────────────────────────────────

interface EKCalendarInfo {
  id: string;
  title: string;
  color: string;
  is_writable: boolean;
  source_title: string;
}

type EKStatus = 'unavailable' | 'not_determined' | 'restricted' | 'denied' | 'authorized' | 'write_only' | 'loading';

function EventKitSection({ existingCalendars }: { existingCalendars: CalendarConfig[] }) {
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
      setError(err instanceof Error ? err.message : "Erreur lors de la demande d'accès");
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

  if (status === 'unavailable') {
    return (
      <div className="empty-state">
        Les calendriers macOS ne sont pas disponibles dans cet environnement.
      </div>
    );
  }

  if (status === 'loading') {
    return <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Chargement…</div>;
  }

  return (
    <>
      <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Affichez et créez des événements directement dans vos calendriers macOS (Calendrier, iCloud, Exchange…).
      </p>

      {status === 'not_determined' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
          <p style={{ margin: 0, fontSize: 14 }}>
            L'accès à vos calendriers macOS n'a pas encore été autorisé.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={requestAccess}
            disabled={requesting}
          >
            {requesting ? 'Demande en cours…' : "🔑 Autoriser l'accès aux calendriers"}
          </button>
          {error && <div style={{ color: 'var(--color-error, #d93025)', fontSize: 13 }}>{error}</div>}
        </div>
      )}

      {(status === 'denied' || status === 'restricted') && (
        <div style={{
          padding: '12px 16px',
          background: 'var(--color-error-bg, #fce8e6)',
          borderRadius: 8,
          fontSize: 14,
          color: 'var(--color-error, #d93025)',
        }}>
          {status === 'denied'
            ? "L'accès aux calendriers a été refusé. Modifiez les permissions dans Réglages Système → Confidentialité & sécurité → Calendriers."
            : "L'accès aux calendriers est restreint par votre organisation."}
        </div>
      )}

      {(status === 'authorized' || status === 'write_only') && ekCals && (
        <>
          {ekCals.length === 0 ? (
            <div className="empty-state">Aucun calendrier trouvé.</div>
          ) : (
            <div className="config-list">
              {ekCals.map((ekCal) => {
                const isAdded = connectedIds.has(ekCal.id);
                return (
                  <label
                    key={ekCal.id}
                    className="config-item"
                    style={{ cursor: 'pointer', gap: 12 }}
                  >
                    <input
                      type="checkbox"
                      checked={isAdded}
                      onChange={() => toggleCalendar(ekCal)}
                      style={{ flexShrink: 0 }}
                    />
                    <span
                      style={{
                        width: 14, height: 14, borderRadius: '50%',
                        background: ekCal.color, flexShrink: 0,
                      }}
                    />
                    <div className="config-item-info">
                      <div className="config-item-name">{ekCal.title}</div>
                      <div className="config-item-url">{ekCal.source_title}</div>
                    </div>
                    {!ekCal.is_writable && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                        lecture seule
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}

// ── ICS calendar list ─────────────────────────────────────────────────────────

function ICSCalendarList({
  calendars,
  editingId,
  editState,
  setEditState,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onRemove,
}: {
  calendars: CalendarConfig[];
  editingId: string | null;
  editState: ICSEditState;
  setEditState: React.Dispatch<React.SetStateAction<ICSEditState>>;
  onStartEdit: (cal: CalendarConfig) => void;
  onSaveEdit: (id: string) => void;
  onCancelEdit: () => void;
  onRemove: (id: string) => void;
}) {
  if (calendars.length === 0) {
    return (
      <div className="empty-state">
        Aucun calendrier ICS. Cliquez sur « Nouveau calendrier » pour en ajouter un.
      </div>
    );
  }

  return (
    <div className="config-list">
      {calendars.map((cal) =>
        editingId === cal.id ? (
          <div className="config-item config-item--editing" key={cal.id}>
            <div className="config-edit-form">
              <div className="form-row">
                <label htmlFor={`edit-name-${cal.id}`}>Nom</label>
                <input
                  id={`edit-name-${cal.id}`}
                  type="text"
                  value={editState.name}
                  onChange={(e) => setEditState((s) => ({ ...s, name: e.target.value }))}
                  autoFocus
                />
              </div>
              <div className="form-row">
                <label htmlFor={`edit-url-${cal.id}`}>URL ICS</label>
                <input
                  id={`edit-url-${cal.id}`}
                  type="url"
                  value={editState.url}
                  onChange={(e) => setEditState((s) => ({ ...s, url: e.target.value }))}
                />
              </div>
              <div className="form-row">
                <label htmlFor={`edit-email-${cal.id}`}>
                  Mon adresse email{' '}
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optionnel)</span>
                </label>
                <input
                  id={`edit-email-${cal.id}`}
                  type="email"
                  placeholder="moi@example.com"
                  value={editState.ownerEmail}
                  onChange={(e) => setEditState((s) => ({ ...s, ownerEmail: e.target.value }))}
                />
              </div>
              <div className="form-row">
                <label htmlFor={`edit-color-${cal.id}`}>Couleur</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <ColorSwatches
                    colors={DEFAULT_COLORS}
                    selected={editState.color}
                    onSelect={(c) => setEditState((s) => ({ ...s, color: c }))}
                  />
                  <input
                    id={`edit-color-${cal.id}`}
                    type="color"
                    value={editState.color}
                    onChange={(e) => setEditState((s) => ({ ...s, color: e.target.value }))}
                  />
                </div>
              </div>
              <div className="config-edit-actions">
                <button className="btn-primary" onClick={() => onSaveEdit(cal.id)}>Enregistrer</button>
                <button className="btn-cancel" onClick={onCancelEdit}>Annuler</button>
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
            <button className="btn-edit" onClick={() => onStartEdit(cal)} title="Modifier">
              <Pencil size={15} />
            </button>
            <button className="btn-remove" onClick={() => onRemove(cal.id)} title="Supprimer">
              <Trash2 size={15} />
            </button>
          </div>
        )
      )}
    </div>
  );
}

// ── Connection test row (shared between list edit form and add modal) ─────────

function ConnectionTestRow({ result, testing, onTest }: {
  result: TestResult | null;
  testing: boolean;
  onTest: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0 8px' }}>
      <button
        type="button"
        className="btn-edit"
        onClick={onTest}
        disabled={testing}
        style={{ fontSize: 13, gap: 6, whiteSpace: 'nowrap' }}
      >
        {testing ? '…' : '⟳ Tester la connexion'}
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

// ── Nextcloud calendar list ───────────────────────────────────────────────────

function NextcloudCalendarList({
  calendars,
  editingId,
  editState,
  setEditState,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onRemove,
}: {
  calendars: CalendarConfig[];
  editingId: string | null;
  editState: NextcloudEditState;
  setEditState: React.Dispatch<React.SetStateAction<NextcloudEditState>>;
  onStartEdit: (cal: CalendarConfig) => void;
  onSaveEdit: (id: string) => void;
  onCancelEdit: () => void;
  onRemove: (id: string) => void;
}) {
  const [listTestResults, setListTestResults] = useState<Record<string, TestResult>>({});
  const [listTesting, setListTesting] = useState<Record<string, boolean>>({});
  const [editTestResult, setEditTestResult] = useState<TestResult | null>(null);
  const [editTesting, setEditTesting] = useState(false);

  const runListTest = async (cal: CalendarConfig) => {
    setListTesting((s) => ({ ...s, [cal.id]: true }));
    setListTestResults((s) => ({ ...s, [cal.id]: { ok: false, message: '' } }));
    const result = await testNextcloudConnection(cal.url, cal.nextcloudUsername ?? '', cal.nextcloudPassword ?? '');
    setListTestResults((s) => ({ ...s, [cal.id]: result }));
    setListTesting((s) => ({ ...s, [cal.id]: false }));
  };

  const runEditTest = async () => {
    setEditTesting(true);
    setEditTestResult(null);
    const result = await testNextcloudConnection(editState.url, editState.username, editState.password);
    setEditTestResult(result);
    setEditTesting(false);
  };

  // Reset edit test result when the edit form changes
  const handleEditStateChange = (updater: (s: NextcloudEditState) => NextcloudEditState) => {
    setEditTestResult(null);
    setEditState(updater);
  };

  if (calendars.length === 0) {
    return (
      <div className="empty-state">
        Aucun calendrier Nextcloud. Cliquez sur « Nouveau calendrier » pour en ajouter un.
      </div>
    );
  }

  return (
    <div className="config-list">
      {calendars.map((cal) =>
        editingId === cal.id ? (
          <div className="config-item config-item--editing" key={cal.id}>
            <div className="config-edit-form">
              <div className="form-row">
                <label htmlFor={`nc-edit-name-${cal.id}`}>Nom</label>
                <input
                  id={`nc-edit-name-${cal.id}`}
                  type="text"
                  value={editState.name}
                  onChange={(e) => handleEditStateChange((s) => ({ ...s, name: e.target.value }))}
                  autoFocus
                />
              </div>
              <div className="form-row">
                <label htmlFor={`nc-edit-url-${cal.id}`}>URL CalDAV</label>
                <input
                  id={`nc-edit-url-${cal.id}`}
                  type="url"
                  placeholder="https://cloud.example.com/remote.php/dav/calendars/…"
                  value={editState.url}
                  onChange={(e) => handleEditStateChange((s) => ({ ...s, url: e.target.value }))}
                />
              </div>
              <div className="form-row">
                <label htmlFor={`nc-edit-user-${cal.id}`}>Nom d'utilisateur</label>
                <input
                  id={`nc-edit-user-${cal.id}`}
                  type="text"
                  value={editState.username}
                  onChange={(e) => handleEditStateChange((s) => ({ ...s, username: e.target.value }))}
                />
              </div>
              <div className="form-row">
                <label htmlFor={`nc-edit-pass-${cal.id}`}>Mot de passe d'application</label>
                <input
                  id={`nc-edit-pass-${cal.id}`}
                  type="password"
                  value={editState.password}
                  onChange={(e) => handleEditStateChange((s) => ({ ...s, password: e.target.value }))}
                />
              </div>
              <div className="form-row">
                <label htmlFor={`nc-edit-color-${cal.id}`}>Couleur</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <ColorSwatches
                    colors={DEFAULT_COLORS}
                    selected={editState.color}
                    onSelect={(c) => handleEditStateChange((s) => ({ ...s, color: c }))}
                  />
                  <input
                    id={`nc-edit-color-${cal.id}`}
                    type="color"
                    value={editState.color}
                    onChange={(e) => handleEditStateChange((s) => ({ ...s, color: e.target.value }))}
                  />
                </div>
              </div>

              <ConnectionTestRow result={editTestResult} testing={editTesting} onTest={runEditTest} />

              <div className="config-edit-actions">
                <button className="btn-primary" onClick={() => onSaveEdit(cal.id)}>Enregistrer</button>
                <button className="btn-cancel" onClick={onCancelEdit}>Annuler</button>
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
              {listTestResults[cal.id] && (
                <div style={{
                  fontSize: 12, marginTop: 3,
                  color: listTestResults[cal.id].ok
                    ? 'var(--color-success, #34a853)'
                    : 'var(--color-error, #d93025)',
                }}>
                  {listTestResults[cal.id].ok ? '✓ ' : '✗ '}
                  {listTestResults[cal.id].message}
                </div>
              )}
            </div>
            <button
              type="button"
              className="btn-edit"
              onClick={() => runListTest(cal)}
              disabled={listTesting[cal.id]}
              title="Tester la connexion"
              style={{ fontSize: 13, gap: 4 }}
            >
              {listTesting[cal.id] ? '…' : '⟳ Tester'}
            </button>
            <button className="btn-edit" onClick={() => onStartEdit(cal)} title="Modifier">
              <Pencil size={15} />
            </button>
            <button className="btn-remove" onClick={() => onRemove(cal.id)} title="Supprimer">
              <Trash2 size={15} />
            </button>
          </div>
        )
      )}
    </div>
  );
}

// ── New calendar modal ────────────────────────────────────────────────────────

function NewCalendarModal({
  onClose,
  onTabChange,
}: {
  onClose: () => void;
  onTabChange: (tab: TabType) => void;
}) {
  const { addCalendar, calendars } = useCalendars();
  const { connectGoogle } = useGoogleAuth();

  const [step, setStep] = useState<'pick' | 'configure'>('pick');
  const [selectedType, setSelectedType] = useState<'ics' | 'nextcloud' | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');

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

  const handleNcTest = async () => {
    setNcTesting(true);
    setNcTestResult(null);
    const result = await testNextcloudConnection(ncCalendarUrl, ncUsername, ncPassword);
    setNcTestResult(result);
    setNcTesting(false);
  };

  const resetNcTest = () => setNcTestResult(null);

  const handleTypeSelect = async (type: 'ics' | 'google' | 'nextcloud') => {
    if (type === 'google') {
      setConnecting(true);
      setConnectError('');
      const account = await connectGoogle();
      setConnecting(false);
      if (account) {
        onTabChange('google');
      } else {
        setConnectError('Connexion annulée ou échouée.');
      }
      return;
    }
    setSelectedType(type);
    setStep('configure');
  };

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
    onTabChange('ics');
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
    onTabChange('nextcloud');
  };

  const typeCards: { type: 'ics' | 'google' | 'nextcloud'; icon: React.ReactNode; label: string; desc: string }[] = [
    {
      type: 'ics',
      icon: <Rss size={28} />,
      label: 'ICS / iCal',
      desc: 'Flux de calendrier via URL publique',
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
      label: 'Google Agenda',
      desc: 'Connexion via compte Google',
    },
    {
      type: 'nextcloud',
      icon: <Cloud size={28} />,
      label: 'Nextcloud',
      desc: 'Calendrier CalDAV Nextcloud',
    },
  ];

  return (
    <div
      className="nc-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`nc-modal-box ${step === 'pick' ? 'nc-modal-box--narrow' : 'nc-modal-box--wide'}`}>
        {/* Modal header */}
        <div className="nc-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {step === 'configure' && (
              <button
                type="button"
                className="nc-modal-back"
                onClick={() => { setStep('pick'); setSelectedType(null); }}
                title="Retour"
              >
                ←
              </button>
            )}
            <h2>
              {step === 'pick' ? 'Nouveau calendrier' : (
                selectedType === 'ics' ? 'Ajouter un calendrier ICS' : 'Ajouter un calendrier Nextcloud'
              )}
            </h2>
          </div>
          <button type="button" className="nc-modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="nc-modal-body">
          {/* Step 1: pick type */}
          {step === 'pick' && (
            <>
              <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--text-muted)' }}>
                Choisissez le type de calendrier à ajouter :
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {typeCards.map(({ type, icon, label, desc }) => (
                  <button
                    key={type}
                    type="button"
                    className="calendar-type-card"
                    onClick={() => handleTypeSelect(type)}
                    disabled={connecting}
                  >
                    <span className="calendar-type-card-icon">{icon}</span>
                    <div>
                      <div className="calendar-type-card-label">{label}</div>
                      <div className="calendar-type-card-desc">{desc}</div>
                    </div>
                  </button>
                ))}
              </div>
              {connectError && (
                <div style={{ marginTop: 12, fontSize: 13, color: 'var(--color-error, #d93025)' }}>
                  {connectError}
                </div>
              )}
              {connecting && (
                <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>
                  Connexion à Google en cours…
                </div>
              )}
            </>
          )}

          {/* Step 2: ICS form */}
          {step === 'configure' && selectedType === 'ics' && (
            <form onSubmit={handleAddICS} className="config-form">
              <div className="form-row">
                <label htmlFor="modal-ics-name">Nom</label>
                <input
                  id="modal-ics-name"
                  type="text"
                  placeholder="Mon calendrier"
                  value={icsName}
                  onChange={(e) => setIcsName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="form-row">
                <label htmlFor="modal-ics-url">URL ICS</label>
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
                  Mon adresse email{' '}
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optionnel)</span>
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
                <label htmlFor="modal-ics-color">Couleur</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <ColorSwatches colors={DEFAULT_COLORS} selected={icsColor} onSelect={setIcsColor} />
                  <input id="modal-ics-color" type="color" value={icsColor} onChange={(e) => setIcsColor(e.target.value)} />
                </div>
              </div>
              <div className="form-actions" style={{ marginTop: 20 }}>
                <button type="submit" className="btn-primary" disabled={!icsName.trim() || !icsUrl.trim()}>
                  Ajouter
                </button>
                <button type="button" className="btn-cancel" onClick={onClose}>
                  Annuler
                </button>
              </div>
            </form>
          )}

          {/* Step 2: Nextcloud form */}
          {step === 'configure' && selectedType === 'nextcloud' && (
            <form onSubmit={handleAddNextcloud} className="config-form">
              <div className="form-row">
                <label htmlFor="modal-nc-name">Nom affiché</label>
                <input
                  id="modal-nc-name"
                  type="text"
                  placeholder="Calendrier personnel"
                  value={ncName}
                  onChange={(e) => setNcName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="form-row">
                <label htmlFor="modal-nc-server">URL du serveur Nextcloud</label>
                <input
                  id="modal-nc-server"
                  type="url"
                  placeholder="https://cloud.example.com"
                  value={ncServerUrl}
                  onChange={(e) => setNcServerUrl(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label htmlFor="modal-nc-cal-url">URL CalDAV du calendrier</label>
                <input
                  id="modal-nc-cal-url"
                  type="url"
                  placeholder="https://cloud.example.com/remote.php/dav/calendars/user/personal/"
                  value={ncCalendarUrl}
                  onChange={(e) => { setNcCalendarUrl(e.target.value); resetNcTest(); }}
                  required
                />
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Chemin complet CalDAV — visible dans Nextcloud → Calendrier → Paramètres
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="modal-nc-user">Nom d'utilisateur</label>
                <input
                  id="modal-nc-user"
                  type="text"
                  value={ncUsername}
                  onChange={(e) => { setNcUsername(e.target.value); resetNcTest(); }}
                />
              </div>
              <div className="form-row">
                <label htmlFor="modal-nc-pass">Mot de passe d'application</label>
                <input
                  id="modal-nc-pass"
                  type="password"
                  placeholder="Généré dans Nextcloud → Sécurité"
                  value={ncPassword}
                  onChange={(e) => { setNcPassword(e.target.value); resetNcTest(); }}
                />
              </div>
              <div className="form-row">
                <label htmlFor="modal-nc-color">Couleur</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <ColorSwatches colors={DEFAULT_COLORS} selected={ncColor} onSelect={setNcColor} />
                  <input id="modal-nc-color" type="color" value={ncColor} onChange={(e) => setNcColor(e.target.value)} />
                </div>
              </div>

              <ConnectionTestRow result={ncTestResult} testing={ncTesting} onTest={handleNcTest} />

              <div className="form-actions" style={{ marginTop: 12 }}>
                <button type="submit" className="btn-primary" disabled={!ncName.trim() || !ncCalendarUrl.trim()}>
                  Ajouter
                </button>
                <button type="button" className="btn-cancel" onClick={onClose}>
                  Annuler
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ConfigPage() {
  const { calendars, removeCalendar, updateCalendar } = useCalendars();
  const { accounts } = useGoogleAuth();

  const [activeTab, setActiveTab] = useState<TabType>('ics');
  const [showModal, setShowModal] = useState(false);

  // Google OAuth client config
  const [gcClientId, setGcClientId] = useState(() => getGoogleClientConfig()?.clientId ?? '');
  const [gcClientSecret, setGcClientSecret] = useState(() => getGoogleClientConfig()?.clientSecret ?? '');
  const [gcSaved, setGcSaved] = useState(false);

  const handleSaveGoogleClientConfig = (e: FormEvent) => {
    e.preventDefault();
    if (gcClientId.trim() && gcClientSecret.trim()) {
      setGoogleClientConfig({ clientId: gcClientId.trim(), clientSecret: gcClientSecret.trim() });
    } else {
      clearGoogleClientConfig();
    }
    setGcSaved(true);
    setTimeout(() => setGcSaved(false), 2500);
  };

  // ICS edit state
  const [icsEditingId, setIcsEditingId] = useState<string | null>(null);
  const [icsEditState, setIcsEditState] = useState<ICSEditState>({ name: '', url: '', color: '', ownerEmail: '' });

  // Nextcloud edit state
  const [ncEditingId, setNcEditingId] = useState<string | null>(null);
  const [ncEditState, setNcEditState] = useState<NextcloudEditState>({ name: '', url: '', username: '', password: '', color: '' });

  const icsCals = calendars.filter((c) => !c.type || c.type === 'ics');
  const nextcloudCals = calendars.filter((c) => c.type === 'nextcloud');
  const eventkitCals = calendars.filter((c) => c.type === 'eventkit');

  const tabs: { id: TabType; label: string; icon: React.ReactNode; count: number }[] = [
    { id: 'ics', label: 'ICS', icon: <Rss size={15} />, count: icsCals.length },
    { id: 'google', label: 'Google', icon: <Globe size={15} />, count: accounts.length },
    { id: 'nextcloud', label: 'Nextcloud', icon: <Cloud size={15} />, count: nextcloudCals.length },
    { id: 'eventkit', label: 'macOS', icon: <Laptop size={15} />, count: eventkitCals.length },
  ];

  // ICS edit handlers
  const startIcsEdit = (cal: CalendarConfig) => {
    setIcsEditingId(cal.id);
    setIcsEditState({ name: cal.name, url: cal.url, color: cal.color, ownerEmail: cal.ownerEmail ?? '' });
  };
  const saveIcsEdit = (id: string) => {
    if (!icsEditState.name.trim() || !icsEditState.url.trim()) return;
    updateCalendar(id, {
      name: icsEditState.name.trim(),
      url: icsEditState.url.trim(),
      color: icsEditState.color,
      ownerEmail: icsEditState.ownerEmail.trim() || undefined,
    });
    setIcsEditingId(null);
  };

  // Nextcloud edit handlers
  const startNcEdit = (cal: CalendarConfig) => {
    setNcEditingId(cal.id);
    setNcEditState({
      name: cal.name,
      url: cal.url,
      username: cal.nextcloudUsername ?? '',
      password: cal.nextcloudPassword ?? '',
      color: cal.color,
    });
  };
  const saveNcEdit = (id: string) => {
    if (!ncEditState.name.trim() || !ncEditState.url.trim()) return;
    updateCalendar(id, {
      name: ncEditState.name.trim(),
      url: ncEditState.url.trim(),
      color: ncEditState.color,
      nextcloudUsername: ncEditState.username.trim() || undefined,
      nextcloudPassword: ncEditState.password || undefined,
    });
    setNcEditingId(null);
  };

  return (
    <div className="app">
      <header className="header">
        <Link to="/" className="btn-config">← Retour au calendrier</Link>
        <span style={{ fontSize: 18, fontWeight: 400 }}>Configurer les calendriers</span>
      </header>

      <div className="app-body" style={{ justifyContent: 'center' }}>
        <div className="config-page">

          {/* ── Tabs + "Nouveau calendrier" ── */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
            marginBottom: 28, borderBottom: '1px solid var(--border)',
          }}>
            <div style={{ display: 'flex', gap: 0 }}>
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '10px 16px',
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: activeTab === tab.id ? 600 : 400,
                    color: activeTab === tab.id ? 'var(--color-primary, #1a73e8)' : 'var(--text-muted)',
                    borderBottom: activeTab === tab.id
                      ? '2px solid var(--color-primary, #1a73e8)'
                      : '2px solid transparent',
                    marginBottom: -1,
                    transition: 'color 0.15s',
                  }}
                >
                  {tab.icon}
                  {tab.label}
                  {tab.count > 0 && (
                    <span style={{
                      background: activeTab === tab.id ? 'var(--color-primary, #1a73e8)' : 'var(--border)',
                      color: activeTab === tab.id ? '#fff' : 'var(--text-secondary, var(--text-muted))',
                      borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 600,
                    }}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="btn-primary"
              onClick={() => setShowModal(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}
            >
              <Plus size={15} />
              Nouveau calendrier
            </button>
          </div>

          {/* ── Tab content ── */}

          {activeTab === 'ics' && (
            <ICSCalendarList
              calendars={icsCals}
              editingId={icsEditingId}
              editState={icsEditState}
              setEditState={setIcsEditState}
              onStartEdit={startIcsEdit}
              onSaveEdit={saveIcsEdit}
              onCancelEdit={() => setIcsEditingId(null)}
              onRemove={removeCalendar}
            />
          )}

          {activeTab === 'google' && (
            <>
              {accounts.length === 0 ? (
                <div className="empty-state">
                  Aucun compte Google connecté. Cliquez sur « Nouveau calendrier » pour connecter un compte.
                </div>
              ) : (
                <div className="config-list">
                  {accounts.map((account) => (
                    <GoogleAccountSection
                      key={account.id}
                      account={account}
                      existingCalendars={calendars}
                    />
                  ))}
                </div>
              )}

              {/* ── OAuth credentials ── */}
              <div style={{ marginTop: 36, paddingTop: 24, borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Identifiants OAuth</h3>
                </div>
                <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  Client ID et Client Secret issus de votre projet{' '}
                  <strong>Google Cloud Console</strong> (type « Application de bureau »).
                  Laissez vide pour utiliser les variables d'environnement <code>VITE_GOOGLE_CLIENT_ID</code> / <code>VITE_GOOGLE_CLIENT_SECRET</code>.
                </p>
                <form onSubmit={handleSaveGoogleClientConfig} className="config-form">
                  <div className="form-row">
                    <label htmlFor="gc-client-id">Client ID</label>
                    <input
                      id="gc-client-id"
                      type="text"
                      placeholder="123456789-abc…apps.googleusercontent.com"
                      value={gcClientId}
                      onChange={(e) => setGcClientId(e.target.value)}
                    />
                  </div>
                  <div className="form-row">
                    <label htmlFor="gc-client-secret">Client Secret</label>
                    <input
                      id="gc-client-secret"
                      type="password"
                      placeholder="GOCSPX-…"
                      value={gcClientSecret}
                      onChange={(e) => setGcClientSecret(e.target.value)}
                    />
                  </div>
                  <div className="form-actions" style={{ alignItems: 'center', gap: 12 }}>
                    <button type="submit" className="btn-primary">Enregistrer</button>
                    {gcSaved && (
                      <span style={{ fontSize: 13, color: 'var(--color-success, #34a853)' }}>
                        ✓ Enregistré
                      </span>
                    )}
                  </div>
                </form>
              </div>
            </>
          )}

          {activeTab === 'nextcloud' && (
            <NextcloudCalendarList
              calendars={nextcloudCals}
              editingId={ncEditingId}
              editState={ncEditState}
              setEditState={setNcEditState}
              onStartEdit={startNcEdit}
              onSaveEdit={saveNcEdit}
              onCancelEdit={() => setNcEditingId(null)}
              onRemove={removeCalendar}
            />
          )}

          {activeTab === 'eventkit' && (
            <EventKitSection existingCalendars={calendars} />
          )}

          {/* ── Modal ── */}
          {showModal && (
            <NewCalendarModal
              onClose={() => setShowModal(false)}
              onTabChange={(tab) => {
                setActiveTab(tab);
                setShowModal(false);
              }}
            />
          )}

        </div>
      </div>
    </div>
  );
}
