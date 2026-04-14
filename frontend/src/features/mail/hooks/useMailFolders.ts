import { useCallback } from 'react';

export function useMailFolders({
  setSelectedAccountId,
  setSelectedFolder,
  setSelectedThread,
  setMessages,
  setReplyingTo,
}: any) {
  const handleFolderSelect = useCallback((accountId: string, folderId: string) => {
    setSelectedAccountId(accountId);
    setSelectedFolder(folderId);
    setSelectedThread(null);
    setMessages([]);
    setReplyingTo(null);
  }, [setSelectedAccountId, setSelectedFolder, setSelectedThread, setMessages, setReplyingTo]);

  return { handleFolderSelect };
}
