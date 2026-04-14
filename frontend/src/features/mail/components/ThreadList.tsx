import { forwardRef } from 'react';
import { MailThread } from '../types';
import { RefreshCw, List, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ThreadItem } from './ThreadItem';

export interface ThreadListProps {
  readonly threads: MailThread[];
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly selectedId: string | null;
  readonly snoozedMap: Record<string, string>;
  readonly isInSnoozedFolder: boolean;
  readonly onSelect: (t: MailThread) => void;
  readonly onToggleRead: (t: MailThread) => void;
  readonly onDelete: (t: MailThread) => void;
  readonly selectedThreadIds: Set<string>;
  readonly onToggleSelect: (t: MailThread) => void;
  readonly onSelectAll: () => void;
  readonly onClearSelection: () => void;
}

export const ThreadList = forwardRef<HTMLDivElement, ThreadListProps>(
  (
    {
      threads,
      loading,
      loadingMore,
      selectedId,
      snoozedMap,
      isInSnoozedFolder,
      onSelect,
      onToggleRead,
      onDelete,
      selectedThreadIds,
      onToggleSelect,
      onSelectAll,
      onClearSelection,
    },
    ref
  ) => {
    const { t } = useTranslation();

    if (loading && threads.length === 0) {
      return (
        <div className="mail-thread-list__empty">
          <RefreshCw size={24} className="spin" />
        </div>
      );
    }

    if (threads.length === 0) {
      return (
        <div className="mail-thread-list__empty">
          <p>{t('mail.no_threads', 'Aucun message')}</p>
        </div>
      );
    }

    return (
      <div className="mail-thread-list" ref={ref}>
        <div className="mail-thread-list__header">
          <div className="mail-thread-list__header-left">
            <button
              className="mail-thread-list__select-all"
              onClick={selectedThreadIds.size === threads.length ? onClearSelection : onSelectAll}
              title={t('mail.select_all', 'Tout sélectionner')}
            >
              <div className={`mail-thread-list__checkbox ${selectedThreadIds.size > 0 ? 'checked' : ''}`}>
                {selectedThreadIds.size === threads.length ? <Check size={12} /> : selectedThreadIds.size > 0 ? <div className="mail-thread-list__checkbox-partial" /> : null}
              </div>
            </button>
            <span className="mail-thread-list__count">
              {threads.length} {t('mail.conversations', 'conversations')}
            </span>
          </div>
          <button className="mail-thread-list__filter-btn">
            <List size={16} />
          </button>
        </div>

        {threads.map((thread) => (
          <ThreadItem
            key={thread.conversation_id}
            thread={thread}
            isSelected={thread.conversation_id === selectedId}
            isChecked={selectedThreadIds.has(thread.conversation_id)}
            snoozeUntil={snoozedMap[thread.conversation_id]}
            isInSnoozedFolder={isInSnoozedFolder}
            onSelect={onSelect}
            onToggleRead={onToggleRead}
            onDelete={onDelete}
            onToggleCheck={onToggleSelect}
          />
        ))}
        {loadingMore && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '12px', opacity: 0.5 }}>
            <RefreshCw size={18} className="spin" />
          </div>
        )}
      </div>
    );
  }
);
ThreadList.displayName = 'ThreadList';
