import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { MailProvider } from '../providers/MailProvider';
import { DISPLAY_TO_STATIC } from '../utils';
import {
  getContactBackfillState,
  recordContactObservations,
  setContactBackfillState,
} from '../utils/contactIndex';

const PAGE_SIZE = 100;
const THREADS_PER_RUN = 1_000;
const RESUME_OVERLAP = 20;
const RETENTION_SECONDS = 365 * 86_400;

interface BackfillAccount {
  id: string;
  email: string;
  providerType: string;
  provider: MailProvider | null;
}

export interface ContactBackfillStatus {
  state: 'idle' | 'running' | 'complete' | 'error';
  accountId?: string;
  folder?: string;
  scanned: number;
  inserted: number;
  error?: string;
}

export function useContactBackfill(accounts: BackfillAccount[]): ContactBackfillStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ContactBackfillStatus>({ state: 'idle', scanned: 0, inserted: 0 });

  useEffect(() => {
    let cancelled = false;
    let completionTimer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      // EWS exposes stable numeric offsets. Other providers need a cursor-based
      // backfill contract before they can safely resume across app restarts.
      for (const account of accounts.filter(item => item.providerType === 'ews' && item.provider?.backfillContacts)) {
        const folders = await account.provider!.listFolders();
        const excluded = new Set(['drafts', 'deleteditems', 'spam', 'snoozed']);
        const dynamicFolders = folders.flatMap(folder => {
          const normalized = DISPLAY_TO_STATIC[folder.display_name.toLowerCase()] ?? folder.folder_id;
          if (excluded.has(normalized) || normalized === 'inbox' || normalized === 'sentitems') return [];
          return [{ id: folder.folder_id, label: folder.display_name }];
        });
        const backfillFolders = [
          { id: 'sentitems', label: 'sentitems' },
          { id: 'inbox', label: 'inbox' },
          ...dynamicFolders,
        ];
        for (const folderEntry of backfillFolders) {
          if (cancelled) return;
          const folder = folderEntry.id;
          const state = await getContactBackfillState(account.id, folder);
          // A completed historical scan must still refresh the newest page on
          // every launch; otherwise mail sent after completion is never learned.
          const refreshNewestOnly = state.completed;
          let offset = refreshNewestOnly
            ? 0
            : Math.max(0, state.offset - (state.offset > 0 ? RESUME_OVERLAP : 0));
          let processed = 0;
          let insertedTotal = 0;
          setStatus({ state: 'running', accountId: account.id, folder: folderEntry.label, scanned: offset, inserted: 0 });
          while (!cancelled) {
            const batch = await account.provider!.backfillContacts!(folder, offset, PAGE_SIZE);
            const cutoff = Math.floor(Date.now() / 1000) - RETENTION_SECONDS;
            const owner = account.email.toLowerCase();
            const observations = batch.observations.filter(observation => {
              const email = observation.email.toLowerCase();
              const localPart = email.split('@', 1)[0].replaceAll(/[._-]/g, '');
              return observation.occurredAt >= cutoff && email !== owner
                && !localPart.includes('noreply') && localPart !== 'mailerdaemon';
            });
            const inserted = await recordContactObservations(account.id, observations);
            insertedTotal += inserted;
            if (inserted > 0) {
              void queryClient.invalidateQueries({ queryKey: ['contact-index'] });
              void queryClient.invalidateQueries({ queryKey: ['contact-index-search'] });
            }

            if (refreshNewestOnly) {
              setStatus({ state: 'running', accountId: account.id, folder: folderEntry.label, scanned: batch.itemCount, inserted: insertedTotal });
              await setContactBackfillState(account.id, folder, state.offset, true);
              break;
            }

            offset += batch.itemCount;
            processed += batch.itemCount;
            setStatus({ state: 'running', accountId: account.id, folder: folderEntry.label, scanned: offset, inserted: insertedTotal });
            const reachedRetentionLimit = batch.oldestAt !== undefined && batch.oldestAt < cutoff;
            const completed = batch.itemCount < PAGE_SIZE || reachedRetentionLimit;
            await setContactBackfillState(account.id, folder, offset, completed);
            if (completed || batch.itemCount === 0) break;
            // Yield between pages so normal mail/calendar requests stay responsive.
            await new Promise(resolve => setTimeout(resolve, 50));
            if (processed >= THREADS_PER_RUN) {
              // Large mailboxes continue in the same session, but with a pause
              // between chunks so foreground synchronization keeps priority.
              processed = 0;
              await new Promise(resolve => setTimeout(resolve, 5_000));
            }
          }
        }
      }
      if (!cancelled) {
        setStatus(current => ({ ...current, state: 'complete' }));
        completionTimer = setTimeout(() => {
          if (!cancelled) setStatus({ state: 'idle', scanned: 0, inserted: 0 });
        }, 30_000);
      }
    };
    void run().catch(error => {
      console.error('[contact-index] backfill failed', error);
      setStatus(current => ({ ...current, state: 'error', error: String(error) }));
    });
    return () => {
      cancelled = true;
      if (completionTimer) clearTimeout(completionTimer);
    };
  }, [accounts, queryClient]);
  return status;
}
