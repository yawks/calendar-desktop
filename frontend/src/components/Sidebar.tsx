import { useState } from 'react';
import {
  AlertCircle, Loader2, Pencil, Check, X,
  GripVertical, ChevronRight, Plus, Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  type DragStartEvent,
  type DragEndEvent,
  useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { CalendarConfig, CalendarGroup } from '../types';
import MiniCalendar from './MiniCalendar';

const COLORS = [
  '#1a73e8', '#34a853', '#ea4335', '#fbbc04',
  '#9c27b0', '#00bcd4', '#ff5722', '#607d8b',
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  readonly calendars: CalendarConfig[];
  readonly groups: CalendarGroup[];
  readonly onToggle: (id: string) => void;
  readonly onUpdate: (id: string, data: Partial<CalendarConfig>) => void;
  readonly onReorderCalendars: (calendars: CalendarConfig[]) => void;
  readonly onAddGroup: (name: string) => void;
  readonly onUpdateGroup: (id: string, data: Partial<CalendarGroup>) => void;
  readonly onRemoveGroup: (id: string) => void;
  readonly loading: boolean;
  readonly errors: Record<string, string>;
  readonly width: number;
  readonly currentDate: Date;
  readonly onNavigateToDate: (date: Date) => void;
}

// ── Sortable calendar item ────────────────────────────────────────────────────

interface CalendarItemProps {
  cal: CalendarConfig;
  isEditing: boolean;
  editName: string;
  editColor: string;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEditNameChange: (v: string) => void;
  onEditColorChange: (v: string) => void;
  onToggle: () => void;
  error?: string;
}

function SortableCalendarItem({
  cal, isEditing, editName, editColor,
  onStartEdit, onSaveEdit, onCancelEdit,
  onEditNameChange, onEditColorChange,
  onToggle, error,
}: CalendarItemProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: cal.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {isEditing ? (
        <div className="calendar-edit-panel">
          <input
            type="text"
            className="calendar-edit-input"
            value={editName}
            onChange={(e) => onEditNameChange(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveEdit();
              if (e.key === 'Escape') onCancelEdit();
            }}
          />
          <div className="calendar-edit-colors">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`calendar-color-swatch${editColor === c ? ' selected' : ''}`}
                style={{ backgroundColor: c }}
                onClick={() => onEditColorChange(c)}
              />
            ))}
            <input
              type="color"
              value={editColor}
              onChange={(e) => onEditColorChange(e.target.value)}
              className="calendar-color-picker"
              title={t('sidebar.customColor')}
            />
          </div>
          <div className="calendar-edit-actions">
            <button type="button" className="calendar-edit-save" onClick={onSaveEdit} title={t('sidebar.save')}>
              <Check size={13} />
            </button>
            <button type="button" className="calendar-edit-cancel" onClick={onCancelEdit} title={t('sidebar.cancel')}>
              <X size={13} />
            </button>
          </div>
        </div>
      ) : (
        <div className="calendar-item-wrapper">
          <button
            type="button"
            className="calendar-drag-handle"
            title={t('sidebar.dragCalendar')}
            {...attributes}
            {...listeners}
          >
            <GripVertical size={12} />
          </button>
          <label className="calendar-item">
            <input
              type="checkbox"
              checked={cal.visible}
              onChange={onToggle}
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
            onClick={(e) => { e.stopPropagation(); onStartEdit(); }}
            title={t('sidebar.rename')}
          >
            <Pencil size={12} />
          </button>
        </div>
      )}
      {error && (
        <div className="sidebar-error" title={error}>
          <AlertCircle size={12} style={{ flexShrink: 0 }} />
          {t('sidebar.loadError')}
        </div>
      )}
    </div>
  );
}

// Lightweight drag overlay preview (no DnD hooks)
function CalendarDragPreview({ cal }: { cal: CalendarConfig }) {
  return (
    <div className="calendar-item-wrapper calendar-drag-preview">
      <span className="calendar-drag-handle" style={{ opacity: 1 }}>
        <GripVertical size={12} />
      </span>
      <div className="calendar-item" style={{ flex: 1 }}>
        <span
          className={`calendar-checkbox ${cal.visible ? 'checked' : ''}`}
          style={{ color: cal.color }}
        />
        <span className="calendar-name">{cal.name}</span>
      </div>
    </div>
  );
}

// ── Group header ──────────────────────────────────────────────────────────────

interface GroupHeaderProps {
  group: CalendarGroup;
  isEmpty: boolean;
  onUpdate: (id: string, data: Partial<CalendarGroup>) => void;
  onRemove: (id: string) => void;
}

function GroupHeader({ group, isEmpty, onUpdate, onRemove }: GroupHeaderProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(group.name);

  const handleSave = () => {
    const trimmed = editName.trim();
    if (trimmed) onUpdate(group.id, { name: trimmed });
    else setEditName(group.name);
    setIsEditing(false);
  };

  const handleStartEdit = () => {
    setEditName(group.name);
    setIsEditing(true);
  };

  const isCollapsed = group.collapsed ?? false;

  return (
    <div className="group-header">
      <button
        type="button"
        className="group-collapse-btn"
        onClick={() => onUpdate(group.id, { collapsed: !isCollapsed })}
        title={isCollapsed ? t('sidebar.expandGroup') : t('sidebar.collapseGroup')}
      >
        <ChevronRight size={12} className={isCollapsed ? '' : 'rotated'} />
      </button>

      {isEditing ? (
        <input
          className="group-name-input"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') { setEditName(group.name); setIsEditing(false); }
          }}
          onBlur={handleSave}
          autoFocus
        />
      ) : (
        <span className="group-name">{group.name}</span>
      )}

      <div className="group-header-actions">
        {!isEditing && (
          <button
            type="button"
            className="group-action-btn"
            onClick={handleStartEdit}
            title={t('sidebar.renameGroup')}
          >
            <Pencil size={11} />
          </button>
        )}
        {isEmpty && group.id !== 'default' && (
          <button
            type="button"
            className="group-action-btn group-delete-btn"
            onClick={() => onRemove(group.id)}
            title={t('sidebar.deleteGroup')}
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Group section (droppable) ─────────────────────────────────────────────────

interface GroupSectionProps {
  group: CalendarGroup;
  groupCalendars: CalendarConfig[];
  editingId: string | null;
  editName: string;
  editColor: string;
  onStartEdit: (cal: CalendarConfig) => void;
  onSaveEdit: (id: string) => void;
  onCancelEdit: () => void;
  onEditNameChange: (v: string) => void;
  onEditColorChange: (v: string) => void;
  onToggle: (id: string) => void;
  onUpdateGroup: (id: string, data: Partial<CalendarGroup>) => void;
  onRemoveGroup: (id: string) => void;
  errors: Record<string, string>;
}

function GroupSection({
  group, groupCalendars,
  editingId, editName, editColor,
  onStartEdit, onSaveEdit, onCancelEdit,
  onEditNameChange, onEditColorChange,
  onToggle, onUpdateGroup, onRemoveGroup, errors,
}: GroupSectionProps) {
  const { setNodeRef } = useDroppable({ id: `group-${group.id}` });
  const isCollapsed = group.collapsed ?? false;

  return (
    <div className="group-section">
      <GroupHeader
        group={group}
        isEmpty={groupCalendars.length === 0}
        onUpdate={onUpdateGroup}
        onRemove={onRemoveGroup}
      />

      {!isCollapsed && (
        <div ref={setNodeRef} className="group-calendars">
          <SortableContext
            items={groupCalendars.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            {groupCalendars.map((cal) => (
              <SortableCalendarItem
                key={cal.id}
                cal={cal}
                isEditing={editingId === cal.id}
                editName={editName}
                editColor={editColor}
                onStartEdit={() => onStartEdit(cal)}
                onSaveEdit={() => onSaveEdit(cal.id)}
                onCancelEdit={onCancelEdit}
                onEditNameChange={onEditNameChange}
                onEditColorChange={onEditColorChange}
                onToggle={() => onToggle(cal.id)}
                error={errors[cal.id]}
              />
            ))}
          </SortableContext>
        </div>
      )}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export default function Sidebar({
  calendars, groups,
  onToggle, onUpdate, onReorderCalendars,
  onAddGroup, onUpdateGroup, onRemoveGroup,
  loading, errors, width, currentDate, onNavigateToDate,
}: Props) {
  const { t } = useTranslation();

  // Calendar edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  // New group form state
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  // DnD state
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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

  const handleAddGroup = () => {
    const name = newGroupName.trim();
    if (name) onAddGroup(name);
    setNewGroupName('');
    setAddingGroup(false);
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over) return;

    const activeCalId = String(active.id);
    const overId = String(over.id);
    if (activeCalId === overId) return;

    const activeCal = calendars.find((c) => c.id === activeCalId);
    if (!activeCal) return;

    const sourceGroupId = activeCal.groupId ?? 'default';
    const isGroupTarget = overId.startsWith('group-');

    if (isGroupTarget) {
      const targetGroupId = overId.slice(6);
      if (targetGroupId === sourceGroupId) return;
      onReorderCalendars(
        calendars.map((c) => (c.id === activeCalId ? { ...c, groupId: targetGroupId } : c))
      );
    } else {
      const overCal = calendars.find((c) => c.id === overId);
      if (!overCal) return;
      const targetGroupId = overCal.groupId ?? 'default';

      if (sourceGroupId === targetGroupId) {
        const ai = calendars.findIndex((c) => c.id === activeCalId);
        const oi = calendars.findIndex((c) => c.id === overId);
        onReorderCalendars(arrayMove(calendars, ai, oi));
      } else {
        let next = calendars.map((c) =>
          c.id === activeCalId ? { ...c, groupId: targetGroupId } : c
        );
        const ai = next.findIndex((c) => c.id === activeCalId);
        const oi = next.findIndex((c) => c.id === overId);
        next = arrayMove(next, ai, oi);
        onReorderCalendars(next);
      }
    }
  };

  const activeCal = activeId ? calendars.find((c) => c.id === activeId) : null;

  const getGroupCalendars = (groupId: string) =>
    calendars.filter((c) => (c.groupId ?? 'default') === groupId);

  return (
    <aside className="sidebar" style={{ width }}>
      <MiniCalendar currentDate={currentDate} onSelectDate={onNavigateToDate} />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {groups.map((group) => (
          <GroupSection
            key={group.id}
            group={group}
            groupCalendars={getGroupCalendars(group.id)}
            editingId={editingId}
            editName={editName}
            editColor={editColor}
            onStartEdit={startEdit}
            onSaveEdit={saveEdit}
            onCancelEdit={cancelEdit}
            onEditNameChange={setEditName}
            onEditColorChange={setEditColor}
            onToggle={onToggle}
            onUpdateGroup={onUpdateGroup}
            onRemoveGroup={onRemoveGroup}
            errors={errors}
          />
        ))}

        <DragOverlay>
          {activeCal ? <CalendarDragPreview cal={activeCal} /> : null}
        </DragOverlay>
      </DndContext>

      {addingGroup ? (
        <div className="add-group-input-row">
          <input
            className="add-group-input"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder={t('sidebar.groupNamePlaceholder')}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddGroup();
              if (e.key === 'Escape') { setNewGroupName(''); setAddingGroup(false); }
            }}
            onBlur={() => { if (!newGroupName.trim()) setAddingGroup(false); }}
          />
          <button type="button" className="calendar-edit-save" onClick={handleAddGroup} title={t('sidebar.save')}>
            <Check size={13} />
          </button>
          <button type="button" className="calendar-edit-cancel" onClick={() => { setNewGroupName(''); setAddingGroup(false); }} title={t('sidebar.cancel')}>
            <X size={13} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="add-group-btn"
          onClick={() => setAddingGroup(true)}
        >
          <Plus size={12} />
          {t('sidebar.newGroup')}
        </button>
      )}

      {loading && (
        <div className="sidebar-loading">
          <Loader2 size={13} className="spin" />
          {t('sidebar.loading')}
        </div>
      )}
    </aside>
  );
}
