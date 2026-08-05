import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, Pencil, Trash2, X } from 'lucide-react';
import { useCalendars } from '../../features/calendar/store/CalendarStore';
import { CalendarConfig } from '../../shared/types';
import { ColorSwatches, ConnectionTestRow, DEFAULT_COLORS, TestResult, testNextcloudConnection } from './ConfigShared';

interface NextcloudEditState {
  name: string;
  url: string;
  username: string;
  password: string;
  color: string;
}

export function NextcloudManageModal({ calendars, onClose }: {
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
