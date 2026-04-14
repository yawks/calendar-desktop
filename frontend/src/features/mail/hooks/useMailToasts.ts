import { useState, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export function useMailToasts({ setFolderUnreadCounts }: any) {
  const [deleteToast, setDeleteToast] = useState<{ label: string } | null>(null);
  const [downloadToast, setDownloadToast] = useState<{ name: string; path: string } | null>(null);
  const [sendToast, setSendToast] = useState<{ label: string } | null>(null);
  const [draftToast, setDraftToast] = useState<{ label: string } | null>(null);
  const [actionToast, setActionToast] = useState<{ label: string } | null>(null);

  const downloadToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showActionToast = useCallback((label: string) => {
    setActionToast({ label });
    if (actionToastTimerRef.current) clearTimeout(actionToastTimerRef.current);
    actionToastTimerRef.current = setTimeout(() => setActionToast(null), 5000);
  }, []);

  const updateBadge = useCallback(async () => {
    try {
      const counts = await invoke<Record<string, number>>('get_total_unread_counts');
      if (setFolderUnreadCounts) {
         setFolderUnreadCounts((prev: any) => ({ ...prev, ...counts }));
      }
    } catch { /* ignore */ }
  }, [setFolderUnreadCounts]);

  return {
    deleteToast, setDeleteToast,
    downloadToast, setDownloadToast,
    sendToast, setSendToast,
    draftToast, setDraftToast,
    actionToast, setActionToast,
    showActionToast,
    downloadToastTimerRef,
    draftToastTimerRef,
    updateBadge,
  };
}
