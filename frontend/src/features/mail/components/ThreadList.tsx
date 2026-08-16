import { forwardRef, useState, useEffect, useRef, useImperativeHandle } from 'react';
import { MailThread } from '../types';
import { RefreshCw, SearchX, Inbox, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ThreadItem } from './ThreadItem';
import { Capacitor } from '@capacitor/core';

const PULL_TO_REFRESH_THRESHOLD = 64;
const PULL_TO_REFRESH_MAX_DISTANCE = 96;

export interface ThreadListProps {
  readonly threads: MailThread[];
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly totalCount?: number;
  readonly scrollResetKey?: string;
  readonly hasMore?: boolean;
  readonly onLoadMore?: () => void;
  readonly onRefresh?: () => Promise<void> | void;
  readonly refreshing?: boolean;
  readonly selectedId: string | null;
  readonly snoozedMap: Record<string, string>;
  readonly isInSnoozedFolder: boolean;
  readonly isSentFolder?: boolean;
  readonly isInScheduledFolder?: boolean;
  readonly isSearchMode?: boolean;
  readonly draftConversationIds?: Set<string>;
  readonly sourceColor?: string;
  readonly onSelect: (t: MailThread) => void;
  readonly onToggleRead: (t: MailThread) => void;
  readonly onDelete: (t: MailThread) => void;
  readonly selectedThreadIds: Set<string>;
  readonly onToggleSelect: (t: MailThread, range?: MailThread[]) => void;
  readonly onSelectAll: () => void;
  readonly onClearSelection: () => void;
  readonly provider?: import('../providers/MailProvider').MailProvider | null;
  readonly resolveProvider?: (thread: MailThread) => import('../providers/MailProvider').MailProvider | null;
}

export const ThreadList = forwardRef<HTMLDivElement, ThreadListProps>(
  (
    {
      threads,
      loading,
      loadingMore,
      totalCount,
      scrollResetKey,
      hasMore = false,
      onLoadMore,
      onRefresh,
      refreshing = false,
      selectedId,
      snoozedMap,
      isInSnoozedFolder,
      isSentFolder = false,
      isInScheduledFolder = false,
      isSearchMode = false,
      draftConversationIds,
      sourceColor,
      onSelect,
      onToggleRead,
      onDelete,
      selectedThreadIds,
      onToggleSelect,
      onSelectAll,
      onClearSelection,
      provider,
      resolveProvider,
    },
    ref
  ) => {
    const { t } = useTranslation();
    const [filter, setFilter] = useState<'all' | 'unread'>('all');
    const lastCheckedIdRef = useRef<string | null>(null);

    useEffect(() => {
      if (selectedThreadIds.size === 0) lastCheckedIdRef.current = null;
    }, [selectedThreadIds.size]);
    const [filterOpen, setFilterOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const loadMoreRequestedRef = useRef(false);
    const touchStartYRef = useRef<number | null>(null);
    const pullDistanceRef = useRef(0);
    const [pullDistance, setPullDistance] = useState(0);

    useImperativeHandle(ref, () => containerRef.current!);

    useEffect(() => {
      if (containerRef.current) containerRef.current.scrollTop = 0;
    }, [scrollResetKey]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container || !onLoadMore) return;

      if (!loadingMore) loadMoreRequestedRef.current = false;

      const handleScroll = () => {
        if (!hasMore || loadingMore || loadMoreRequestedRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = container;
        if (scrollHeight - scrollTop - clientHeight < 200) {
          loadMoreRequestedRef.current = true;
          onLoadMore();
        }
      };

      container.addEventListener('scroll', handleScroll, { passive: true });
      return () => container.removeEventListener('scroll', handleScroll);
    }, [onLoadMore, hasMore, loadingMore, threads.length]);

    useEffect(() => {
      const container = containerRef.current;
      const isMobileLayout = globalThis.matchMedia?.('(max-width: 700px)').matches ?? false;
      if (!container || !onRefresh || (Capacitor.getPlatform() !== 'android' && !isMobileLayout)) return;

      const handleTouchStart = (event: TouchEvent) => {
        if (refreshing || container.scrollTop > 0 || event.touches.length !== 1) {
          touchStartYRef.current = null;
          return;
        }
        touchStartYRef.current = event.touches[0].clientY;
      };

      const handleTouchMove = (event: TouchEvent) => {
        if (touchStartYRef.current === null || event.touches.length !== 1) return;
        const delta = event.touches[0].clientY - touchStartYRef.current;
        if (delta <= 0 || container.scrollTop > 0) {
          pullDistanceRef.current = 0;
          setPullDistance(0);
          return;
        }
        event.preventDefault();
        const nextDistance = Math.min(PULL_TO_REFRESH_MAX_DISTANCE, delta * 0.5);
        pullDistanceRef.current = nextDistance;
        setPullDistance(nextDistance);
      };

      const resetPull = () => {
        touchStartYRef.current = null;
        pullDistanceRef.current = 0;
        setPullDistance(0);
      };

      const finishPull = () => {
        const shouldRefresh = pullDistanceRef.current >= PULL_TO_REFRESH_THRESHOLD && !refreshing;
        resetPull();
        if (shouldRefresh) void onRefresh();
      };

      container.addEventListener('touchstart', handleTouchStart, { passive: true });
      container.addEventListener('touchmove', handleTouchMove, { passive: false });
      container.addEventListener('touchend', finishPull);
      container.addEventListener('touchcancel', resetPull);
      return () => {
        container.removeEventListener('touchstart', handleTouchStart);
        container.removeEventListener('touchmove', handleTouchMove);
        container.removeEventListener('touchend', finishPull);
        container.removeEventListener('touchcancel', resetPull);
      };
    }, [onRefresh, refreshing]);

    const pullIndicator = (pullDistance > 0 || refreshing) && (
      <div
        className={'mail-pull-to-refresh' + (refreshing ? ' mail-pull-to-refresh--refreshing' : '')}
        style={{ height: refreshing ? 42 : pullDistance }}
        aria-hidden="true"
      >
        <RefreshCw
          size={20}
          className={refreshing ? 'spin' : ''}
          style={{ transform: refreshing ? undefined : 'rotate(' + Math.min(180, pullDistance * 2.8) + 'deg)' }}
        />
      </div>
    );

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      let timer: ReturnType<typeof setTimeout>;
      const onScroll = () => {
        el.style.setProperty('scrollbar-color', 'color-mix(in srgb, var(--text-muted) 55%, transparent) transparent');
        clearTimeout(timer);
        timer = setTimeout(() => el.style.setProperty('scrollbar-color', 'transparent transparent'), 1000);
      };
      el.addEventListener('scroll', onScroll, { passive: true });
      return () => { el.removeEventListener('scroll', onScroll); clearTimeout(timer); };
    }, [loading]); // re-run quand loading passe à false pour que le ref soit attaché

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
          <div className="mail-thread-list mail-thread-list--loading">
            {toolbar}
            {Array.from({ length: 12 }, (_, index) => (
              <div className="mail-thread-list-skeleton" key={index} aria-hidden="true">
                <span className="mail-thread-list-skeleton__avatar" />
                <span className="mail-thread-list-skeleton__content">
                  <span className="mail-thread-list-skeleton__sender" />
                  <span className="mail-thread-list-skeleton__subject" />
                  <span className="mail-thread-list-skeleton__preview" />
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    const countChip = !isSearchMode && (
      <div className="mail-thread-list__count-chip">
        <span>
          {totalCount === undefined || filter === 'unread'
            ? visibleThreads.length
            : `${visibleThreads.length} / ${Math.max(visibleThreads.length, totalCount)}`}{' '}
          {t('mail.conversations', 'conversations')}
        </span>
      </div>
    );

    if (visibleThreads.length === 0) {
      return (
        <div className="mail-thread-list-wrapper">
          <div className="mail-thread-list" ref={containerRef}>
            {pullIndicator}
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
          {pullIndicator}
          {toolbar}
          {selectedThreadIds.size > 0 && (
            <div className="mail-mobile-selection-header">
              <strong>{selectedThreadIds.size} sélectionnée{selectedThreadIds.size > 1 ? "s" : ""}</strong>
              <button type="button" onClick={onClearSelection} aria-label={t("mail.selection.clear", "Clear selection")}>
                <X size={24} />
              </button>
            </div>
          )}
          {visibleThreads.map((thread) => (
            <ThreadItem
              key={(thread.accountId ?? '') + '_' + thread.conversation_id}
              thread={thread}
              isSelected={thread.conversation_id === selectedId}
              isChecked={selectedThreadIds.has(thread.conversation_id)}
              snoozeUntil={thread.snoozed_until ?? snoozedMap[thread.conversation_id]}
              isInSnoozedFolder={isInSnoozedFolder}
              isSentFolder={isSentFolder}
              isInScheduledFolder={isInScheduledFolder}
              hasDraft={draftConversationIds?.has(thread.conversation_id) ?? false}
              sourceColor={sourceColor}
              provider={resolveProvider?.(thread) ?? provider}
              onSelect={clickedThread => {
                if (selectedThreadIds.size > 0 && globalThis.matchMedia?.("(max-width: 700px)").matches) {
                  onToggleSelect(clickedThread);
                  return;
                }
                onSelect(clickedThread);
              }}
              onToggleRead={onToggleRead}
              onDelete={onDelete}
              onToggleCheck={(clickedThread, shiftKey) => {
                const anchorIndex = lastCheckedIdRef.current
                  ? visibleThreads.findIndex(t => t.conversation_id === lastCheckedIdRef.current)
                  : -1;
                const clickedIndex = visibleThreads.findIndex(t => t.conversation_id === clickedThread.conversation_id);

                if (shiftKey && anchorIndex >= 0 && clickedIndex >= 0) {
                  const start = Math.min(anchorIndex, clickedIndex);
                  const end = Math.max(anchorIndex, clickedIndex);
                  onToggleSelect(clickedThread, visibleThreads.slice(start, end + 1));
                  lastCheckedIdRef.current = clickedThread.conversation_id;
                  return;
                }

                onToggleSelect(clickedThread);
                if (!selectedThreadIds.has(clickedThread.conversation_id)) {
                  lastCheckedIdRef.current = clickedThread.conversation_id;
                }
              }}
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
