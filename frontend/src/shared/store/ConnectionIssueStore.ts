import { useSyncExternalStore } from 'react';

export type ConnectionProvider = 'exchange' | 'google' | 'imap' | 'jmap';

export interface ConnectionIssue {
  accountId: string;
  provider: ConnectionProvider;
  message: string;
}

const STORAGE_KEY = 'calendar-desktop-connection-issues';
const EVENT_NAME = 'calendar-desktop-connection-issues-changed';

function readIssues(): ConnectionIssue[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as ConnectionIssue[];
  } catch {
    return [];
  }
}

let snapshot = readIssues();
const emit = () => globalThis.dispatchEvent(new Event(EVENT_NAME));
const write = (issues: ConnectionIssue[]) => {
  snapshot = issues;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(issues));
  emit();
};

export function isConnectionFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no valid .*token|invalid[_ ]grant|invalid token|unauthori[sz]ed|authentication failed|invalid credentials|please reconnect/i.test(message);
}

export function reportConnectionIssue(issue: ConnectionIssue) {
  const current = readIssues();
  write([...current.filter(item => item.accountId !== issue.accountId), issue]);
}

export function clearConnectionIssue(accountId: string) {
  const current = readIssues();
  if (current.some(item => item.accountId === accountId)) {
    write(current.filter(item => item.accountId !== accountId));
  }
}

export function useConnectionIssues() {
  return useSyncExternalStore(
    listener => {
      globalThis.addEventListener(EVENT_NAME, listener);
      return () => globalThis.removeEventListener(EVENT_NAME, listener);
    },
    () => snapshot,
  );
}
