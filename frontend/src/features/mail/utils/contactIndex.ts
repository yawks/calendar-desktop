import { invoke } from '@tauri-apps/api/core';

export interface ContactObservation {
  email: string;
  displayName?: string;
  kind: 'received' | 'sent' | 'event';
  occurredAt: number;
  eventId: string;
}

export interface IndexedContact {
  email: string;
  name?: string;
  receivedCount: number;
  sentCount: number;
  eventCount: number;
  lastSeenAt: number;
}

export interface ContactBackfillState {
  offset: number;
  completed: boolean;
}

const UUID_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function usableContactName(name: string | undefined, email: string): string | undefined {
  const value = name?.trim();
  if (!value || value.toLowerCase() === email.trim().toLowerCase() || UUID_NAME.test(value)) return undefined;
  return value;
}

export function recordContactObservations(accountId: string, observations: ContactObservation[]): Promise<number> {
  if (!accountId || observations.length === 0) return Promise.resolve(0);
  return invoke<number>('contact_index_record', { accountId, observations });
}

export function searchContactIndex(accountIds: string[], query = '', maxCount = 200): Promise<IndexedContact[]> {
  if (accountIds.length === 0) return Promise.resolve([]);
  return invoke<IndexedContact[]>('contact_index_search', { accountIds, query, maxCount });
}

export function cleanupContactIndex(maxAgeDays = 365): Promise<number> {
  return invoke<number>('contact_index_cleanup', { maxAgeDays });
}

export function getContactBackfillState(accountId: string, folder: string): Promise<ContactBackfillState> {
  return invoke<ContactBackfillState>('contact_backfill_get_state', { accountId, folder });
}

export function setContactBackfillState(
  accountId: string, folder: string, offset: number, completed: boolean,
): Promise<void> {
  return invoke<void>('contact_backfill_set_state', { accountId, folder, offset, completed });
}
