import { useEffect, useRef } from 'react';

import { invoke } from '@tauri-apps/api/core';

/**
 * Updates the macOS Dock badge with the total number of unread inbox messages.
 * Does NOT clear the badge on unmount — the last known value persists so the
 * badge remains visible even when the Mail page is swapped for the Calendar page
 * in tabbed mode. On non-macOS platforms this is a no-op.
 */
export function useDockBadge(folderUnreadCounts: Record<string, number>) {
  // Track the last sent count so we don't send redundant invocations.
  const lastSentRef = useRef<number | null>(null);

  useEffect(() => {
    const inboxUnread = folderUnreadCounts['inbox'] ?? 0;

    // Skip if the value hasn't changed since the last invoke call.
    if (inboxUnread === lastSentRef.current) return;
    lastSentRef.current = inboxUnread;

    invoke('set_badge_count', { count: inboxUnread }).catch(() => {
      // Silently ignore — the Tauri command is only available on native builds.
    });
  }, [folderUnreadCounts]);
}
