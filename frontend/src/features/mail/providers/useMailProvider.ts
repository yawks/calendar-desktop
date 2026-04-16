import { useMemo } from 'react';

import { EwsMailProvider } from './EwsMailProvider';
import { GmailMailProvider } from './GmailMailProvider';
import { ImapMailProvider } from './ImapMailProvider';
import type { MailProvider, ProviderType } from './MailProvider';

/**
 * Returns a MailProvider for the active account.
 *
 * To add a new provider, add it to ProviderType in MailProvider.ts and
 * handle it here — the rest of the UI stays unchanged.
 */
export function useMailProvider(
  accountId: string | null,
  providerType: ProviderType | null,
  getValidToken: (id: string) => Promise<string | null>,
): MailProvider | null {
  return useMemo(() => {
    if (!accountId || !providerType) return null;
    switch (providerType) {
      case 'ews':
        return new EwsMailProvider(accountId, getValidToken);
      case 'gmail':
        return new GmailMailProvider(accountId, getValidToken);
      case 'imap':
        // ImapMailProvider needs config, not just token.
        // This might need a different approach if we want to support it here.
        return null;
    }
  // getValidToken is intentionally excluded: it's a stable store function,
  // and including it would recreate the provider on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, providerType]);
}
