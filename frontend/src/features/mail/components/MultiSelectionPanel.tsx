import { useState } from 'react';
import { MailThread } from '../types';
import {
  Archive, Clock, FolderInput, Mail as MailIcon,
  MailOpen, Trash2, X
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FolderPickerPopover } from './FolderPickerPopover';

export interface MultiSelectionPanelProps {
  readonly threads: MailThread[];
  readonly selectedIds: Set<string>;
  readonly onClearSelection: () => void;
  readonly onBulkDelete: () => void;
  readonly onBulkArchive?: () => void;
  readonly onBulkSnooze: (until: string) => void;
  readonly onBulkMove: (folderId: string) => void;
  readonly onBulkToggleRead: (markAsRead: boolean) => void;
  readonly moveFolders: import('../types').MailFolder[];
  readonly supportsSnooze: boolean;
}

const FR_DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

function computeSnoozeOptions() {
  const now = new Date();
  const tomorrowMorning = new Date(now);
  tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
  tomorrowMorning.setHours(9, 0, 0, 0);

  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + 7);
  nextWeek.setHours(9, 0, 0, 0);

  return { tomorrowMorning, nextWeek };
}

export function MultiSelectionPanel({
  selectedIds, onClearSelection, onBulkDelete, onBulkArchive,
  onBulkSnooze, onBulkMove, onBulkToggleRead, moveFolders, supportsSnooze
}: MultiSelectionPanelProps) {
  const { t } = useTranslation();
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const [showMoveMenu, setShowMoveMenu] = useState(false);

  const { tomorrowMorning, nextWeek } = computeSnoozeOptions();

  return (
    <div className="mail-multi-select-panel">
      <div className="mail-multi-select-panel__left">
        <button className="mail-multi-select-panel__close" onClick={onClearSelection}>
          <X size={20} />
        </button>
        <span className="mail-multi-select-panel__count">
          {selectedIds.size} {t('mail.selected', 'sélectionnés')}
        </span>
      </div>

      <div className="mail-multi-select-panel__actions">
        <button className="mail-multi-select-panel__action" onClick={() => onBulkToggleRead(true)} title={t('mail.markAsRead', 'Marquer comme lu')}>
          <MailOpen size={20} />
        </button>
        <button className="mail-multi-select-panel__action" onClick={() => onBulkToggleRead(false)} title={t('mail.markAsUnread', 'Marquer comme non lu')}>
          <MailIcon size={20} />
        </button>
        <button className="mail-multi-select-panel__action" onClick={onBulkDelete} title={t('mail.delete', 'Supprimer')}>
          <Trash2 size={20} />
        </button>
        <button className="mail-multi-select-panel__action" onClick={onBulkArchive} title={t('mail.archive', 'Archiver')}>
          <Archive size={20} />
        </button>

        <div style={{ position: 'relative' }}>
          <button className="mail-multi-select-panel__action" onClick={() => setShowMoveMenu(!showMoveMenu)} title={t('mail.move', 'Déplacer')}>
            <FolderInput size={20} />
          </button>
          {showMoveMenu && (
            <FolderPickerPopover
              folders={moveFolders}
              onSelect={(fid) => { onBulkMove(fid); setShowMoveMenu(false); }}
              onClose={() => setShowMoveMenu(false)}
            />
          )}
        </div>

        {supportsSnooze && (
          <div style={{ position: 'relative' }}>
            <button className="mail-multi-select-panel__action" onClick={() => setShowSnoozeMenu(!showSnoozeMenu)} title={t('mail.snooze', 'Mettre en attente')}>
              <Clock size={20} />
            </button>
            {showSnoozeMenu && (
              <div className="mail-snooze-menu">
                <div className="mail-snooze-menu__item" onClick={() => { onBulkSnooze(tomorrowMorning.toISOString()); setShowSnoozeMenu(false); }}>
                  <span>{t('mail.tomorrow', 'Demain')}</span>
                  <span className="mail-snooze-menu__date">{FR_DAYS[tomorrowMorning.getDay()]} 09:00</span>
                </div>
                <div className="mail-snooze-menu__item" onClick={() => { onBulkSnooze(nextWeek.toISOString()); setShowSnoozeMenu(false); }}>
                  <span>{t('mail.nextWeek', 'La semaine prochaine')}</span>
                  <span className="mail-snooze-menu__date">{FR_DAYS[nextWeek.getDay()]} 09:00</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
