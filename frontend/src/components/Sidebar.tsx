import { useState } from 'react';
import { AlertCircle, Loader2, Pencil, Check, X } from 'lucide-react';
import { CalendarConfig } from '../types';
import MiniCalendar from './MiniCalendar';

const COLORS = [
  '#1a73e8', '#34a853', '#ea4335', '#fbbc04',
  '#9c27b0', '#00bcd4', '#ff5722', '#607d8b',
];

interface Props {
  readonly calendars: CalendarConfig[];
  readonly onToggle: (id: string) => void;
  readonly onUpdate: (id: string, data: Partial<CalendarConfig>) => void;
  readonly loading: boolean;
  readonly errors: Record<string, string>;
  readonly width: number;
  readonly currentDate: Date;
  readonly onNavigateToDate: (date: Date) => void;
}

export default function Sidebar({ calendars, onToggle, onUpdate, loading, errors, width, currentDate, onNavigateToDate }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  const startEdit = (cal: CalendarConfig) => {
    setEditingId(cal.id);
    setEditName(cal.name);
    setEditColor(cal.color);
  };

  const saveEdit = (id: string) => {
    if (editName.trim()) {
      onUpdate(id, { name: editName.trim(), color: editColor });
    }
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  return (
    <aside className="sidebar" style={{ width }}>
      <MiniCalendar currentDate={currentDate} onSelectDate={onNavigateToDate} />

      <div className="sidebar-section-title">Mes calendriers</div>

      {calendars.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px' }}>
          Aucun calendrier configuré
        </p>
      )}

      {calendars.map((cal) => (
        <div key={cal.id}>
          {editingId === cal.id ? (
            <div className="calendar-edit-panel">
              <input
                type="text"
                className="calendar-edit-input"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveEdit(cal.id);
                  if (e.key === 'Escape') cancelEdit();
                }}
              />
              <div className="calendar-edit-colors">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`calendar-color-swatch${editColor === c ? ' selected' : ''}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setEditColor(c)}
                  />
                ))}
                <input
                  type="color"
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                  className="calendar-color-picker"
                  title="Couleur personnalisée"
                />
              </div>
              <div className="calendar-edit-actions">
                <button type="button" className="calendar-edit-save" onClick={() => saveEdit(cal.id)} title="Enregistrer">
                  <Check size={13} />
                </button>
                <button type="button" className="calendar-edit-cancel" onClick={cancelEdit} title="Annuler">
                  <X size={13} />
                </button>
              </div>
            </div>
          ) : (
            <div className="calendar-item-wrapper">
              <label className="calendar-item">
                <input
                  type="checkbox"
                  checked={cal.visible}
                  onChange={() => onToggle(cal.id)}
                  style={{ display: 'none' }}
                />
                <span
                  className={`calendar-checkbox ${cal.visible ? 'checked' : ''}`}
                  style={{ color: cal.color }}
                />
                <span className="calendar-name">{cal.name}</span>
              </label>
              <button
                type="button"
                className="calendar-edit-btn"
                onClick={(e) => { e.stopPropagation(); startEdit(cal); }}
                title="Renommer"
              >
                <Pencil size={12} />
              </button>
            </div>
          )}
          {errors[cal.id] && (
            <div className="sidebar-error" title={errors[cal.id]}>
              <AlertCircle size={12} style={{ flexShrink: 0 }} />
              Erreur de chargement
            </div>
          )}
        </div>
      ))}

      {loading && (
        <div className="sidebar-loading">
          <Loader2 size={13} className="spin" />
          Chargement…
        </div>
      )}
    </aside>
  );
}
