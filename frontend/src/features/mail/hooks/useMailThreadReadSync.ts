import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Folder, MailThread } from '../types';

export function useMailThreadReadSync(
  setThreads: Dispatch<SetStateAction<MailThread[]>>,
  selectedAccountId: string,
  selectedFolder: Folder,
  isAllMode: boolean,
) {
  const queryClient = useQueryClient();
  // Earlier pages are no longer observed by useQuery after loading the next page.
  useEffect(() => queryClient.getQueryCache().subscribe(event => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    const [scope, accountId, kind, folder] = event.query.queryKey;
    if (scope !== 'mail' || kind !== 'threads' || folder !== selectedFolder) return;
    if (!isAllMode && accountId !== selectedAccountId) return;
    const rows = event.query.state.data as MailThread[] | undefined;
    if (!Array.isArray(rows)) return;
    const updates = new Map(rows.map(row => [row.conversation_id, row]));
    setThreads(previous => {
      let changed = false;
      const next = previous.map(thread => {
        if ((thread.accountId ?? selectedAccountId) !== accountId) return thread;
        const update = updates.get(thread.conversation_id);
        if (!update || update.unread_count === thread.unread_count) return thread;
        changed = true;
        return { ...thread, unread_count: update.unread_count };
      });
      return changed ? next : previous;
    });
  }), [queryClient, setThreads, selectedAccountId, selectedFolder, isAllMode]);
}
