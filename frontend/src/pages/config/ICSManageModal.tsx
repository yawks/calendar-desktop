import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Rss, Trash2, X } from 'lucide-react';
import { useCalendars } from '../../features/calendar/store/CalendarStore';
import { CalendarConfig } from '../../shared/types';
import { ColorSwatches, DEFAULT_COLORS } from './ConfigShared';

interface ICSEditState {
  name: string;
  url: string;
  color: string;
  ownerEmail: string;
}

export function ICSManageModal({ calendars, onClose }: {
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
