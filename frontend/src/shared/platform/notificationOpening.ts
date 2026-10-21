import { useSyncExternalStore } from 'react';

// Start paused: NativeDeepLinks resolves the retained/launch intent before
// allowing non-essential mail enrichment. This protects cold launches, where
// providers can mount before Capacitor returns the notification intent.
let opening = true;
const listeners = new Set<() => void>();

export function setNotificationOpening(value: boolean) {
  if (opening === value) return;
  opening = value;
  listeners.forEach(listener => listener());
}

export function useNotificationOpening() {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => listeners.delete(listener); },
    () => opening,
    () => false,
  );
}
