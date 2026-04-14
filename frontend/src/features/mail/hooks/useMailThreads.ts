import { useState, useCallback, useRef } from 'react';
import { MailThread } from '../types';

export function useMailThreads() {
  const [threads, setThreads] = useState<MailThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsLoadingMore, setThreadsLoadingMore] = useState(false);
  const [hasMoreThreads, setHasMoreThreads] = useState(true);
  const [selectedThread, setSelectedThread] = useState<MailThread | null>(null);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const threadListRef = useRef<HTMLDivElement>(null);

  const toggleThreadSelection = useCallback((thread: MailThread) => {
    setSelectedThreadIds((prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(thread.conversation_id)) next.delete(thread.conversation_id);
      else next.add(thread.conversation_id);
      return next;
    });
  }, []);

  const selectAllThreads = useCallback((visibleThreads: MailThread[]) => {
     setSelectedThreadIds(new Set(visibleThreads.map(t => t.conversation_id)));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedThreadIds(new Set());
  }, []);

  return {
    threads, setThreads,
    threadsLoading, setThreadsLoading,
    threadsLoadingMore, setThreadsLoadingMore,
    hasMoreThreads, setHasMoreThreads,
    selectedThread, setSelectedThread,
    selectedThreadIds, setSelectedThreadIds,
    threadListRef,
    toggleThreadSelection,
    selectAllThreads,
    clearSelection,
  };
}
