import { useCallback } from 'react';

export function useMailDeletion({
  resolveProvider,
  selectedThread,
  setSelectedThread,
  silentRefresh,
  setError,
}: any) {

  const handleDelete = useCallback(async () => {
    if (!selectedThread) return;
    const p = resolveProvider(selectedThread.accountId);
    if (!p) return;
    try {
      await p.moveToTrash(selectedThread.conversation_id);
      setSelectedThread(null);
      silentRefresh();
    } catch (e: any) {
      setError(String(e));
    }
  }, [selectedThread, resolveProvider, setSelectedThread, silentRefresh, setError]);

  const handleArchive = useCallback(async () => {
    if (!selectedThread) return;
    const p = resolveProvider(selectedThread.accountId);
    if (!p) return;
    try {
      await p.moveToFolder(selectedThread.conversation_id, 'archive');
      setSelectedThread(null);
      silentRefresh();
    } catch (e: any) {
      setError(String(e));
    }
  }, [selectedThread, resolveProvider, setSelectedThread, silentRefresh, setError]);

  const handleToggleRead = useCallback(async (msg: any) => {
    const p = resolveProvider(selectedThread?.accountId);
    if (!p) return;
    try {
      if (msg.is_read) await p.markUnread([{ item_id: msg.item_id, change_key: msg.change_key }]);
      else await p.markRead([{ item_id: msg.item_id, change_key: msg.change_key }]);
      silentRefresh();
    } catch (e: any) {
      setError(String(e));
    }
  }, [selectedThread, resolveProvider, silentRefresh, setError]);

  return { handleDelete, handleArchive, handleToggleRead };
}
