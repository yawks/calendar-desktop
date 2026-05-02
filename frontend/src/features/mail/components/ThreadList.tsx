import { forwardRef, useState, useEffect, useRef, useImperativeHandle } from 'react';
import { MailThread } from '../types';
import { RefreshCw, SearchX, Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ThreadItem } from './ThreadItem';

export interface ThreadListProps {
  readonly threads: MailThread[];
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly hasMore?: boolean;
  readonly onLoadMore?: () => void;
  readonly selectedId: string | null;
  readonly snoozedMap: Record<string, string>;
  readonly isInSnoozedFolder: boolean;
  readonly isSearchMode?: boolean;
  readonly draftConversationIds?: Set<string>;
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
      hasMore = false,
      onLoadMore,
      selectedId,
      snoozedMap,
      isInSnoozedFolder,
      isSearchMode = false,
      draftConversationIds,
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
    const [filter, setFilter] = useState<'all' | 'unread'>('all');
    const [filterOpen, setFilterOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => containerRef.current!);

    useEffect(() => {
      const container = containerRef.current;
      if (!container || !onLoadMore) return;

      const handleScroll = () => {
        if (!hasMore || loadingMore) return;
        const { scrollTop, scrollHeight, clientHeight } = container;
        if (scrollHeight - scrollTop - clientHeight < 200) {
          onLoadMore();
        }
      };

      container.addEventListener('scroll', handleScroll, { passive: true });
      return () => container.removeEventListener('scroll', handleScroll);
    }, [onLoadMore, hasMore, loadingMore]);

    const allSelected = threads.length > 0 && selectedThreadIds.size === threads.length;

    const handleToolbarCheckbox = () => {
      if (allSelected) {
        onClearSelection();
      } else {
        onSelectAll();
      }
    };

    const visibleThreads = (!isSearchMode && filter === 'unread')
      ? threads.filter(t => t.unread_count > 0)
      : threads;

    const toolbar = (
      <div className="mail-thread-toolbar">
        <input
          type="checkbox"
          className="mail-thread-toolbar__checkbox"
          checked={allSelected}
          onChange={handleToolbarCheckbox}
          aria-label={t('mail.selectAll', 'Select all')}
        />
        {isSearchMode ? (
          <span className="mail-thread-toolbar__search-count">
            {t('mail.search.results', '{{count}} result(s)', { count: threads.length })}
          </span>
        ) : (
          <div className="mail-actions-dropdown">
            <button
              className="btn-icon--labeled mail-thread-toolbar__filter-btn"
              onClick={() => setFilterOpen(o => !o)}
            >
              {filter === 'unread' ? t('mail.filterUnread', 'Unread') : t('mail.filterAll', 'All mail')}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.5 }}>
                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {filterOpen && (
              <>
                <button type="button" aria-label="Close" className="mail-thread-toolbar__overlay" onClick={() => setFilterOpen(false)} />
                <div className="mail-actions-menu">
                  <button
                    className={`mail-actions-menu__item${filter === 'all' ? ' mail-actions-menu__item--active' : ''}`}
                    onClick={() => { setFilter('all'); setFilterOpen(false); }}
                  >
                    {t('mail.filterAll', 'All mail')}
                  </button>
                  <button
                    className={`mail-actions-menu__item${filter === 'unread' ? ' mail-actions-menu__item--active' : ''}`}
                    onClick={() => { setFilter('unread'); setFilterOpen(false); }}
                  >
                    {t('mail.filterUnread', 'Unread')}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );

    if (loading) {
      return (
        <div className="mail-thread-list-wrapper">
          <div className="mail-thread-list mail-thread-list--empty">
            <RefreshCw size={24} className="spin" style={{ opacity: 0.4 }} />
          </div>
        </div>
      );
    }

    const countChip = !isSearchMode && (
      <div className="mail-thread-list__count-chip">
        <span>{visibleThreads.length} {t('mail.conversations', 'conversations')}</span>
      </div>
    );

    if (visibleThreads.length === 0) {
      return (
        <div className="mail-thread-list-wrapper">
          <div className="mail-thread-list" ref={containerRef}>
            {toolbar}
            <div className="mail-thread-list--empty">
              {isSearchMode
                ? <SearchX size={40} strokeWidth={1} style={{ opacity: 0.25 }} />
                : <Inbox size={40} strokeWidth={1} style={{ opacity: 0.25 }} />}
              <p style={{ opacity: 0.4 }}>
                {isSearchMode
                  ? t('mail.search.noResults', 'No results')
                  : t('mail.empty', 'No messages')}
              </p>
            </div>
          </div>
          {countChip}
        </div>
      );
    }

    return (
      <div className="mail-thread-list-wrapper">
        <div className="mail-thread-list" ref={containerRef}>
          {toolbar}
          {visibleThreads.map((thread) => (
            <ThreadItem
              key={(thread.accountId ?? '') + '_' + thread.conversation_id}
              thread={thread}
              isSelected={thread.conversation_id === selectedId}
              isChecked={selectedThreadIds.has(thread.conversation_id)}
              snoozeUntil={snoozedMap[thread.conversation_id]}
              isInSnoozedFolder={isInSnoozedFolder}
              hasDraft={draftConversationIds?.has(thread.conversation_id) ?? false}
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
        {countChip}
      </div>
    );
  }
);
ThreadList.displayName = 'ThreadList';
