import { useMemo } from 'react';
import { useGoogleAuth } from '../../../store/GoogleAuthStore';
import { useExchangeAuth } from '../../../store/ExchangeAuthStore';
import { GmailMailProvider } from '../providers/GmailMailProvider';
import { EwsMailProvider } from '../providers/EwsMailProvider';
import { CachedMailProvider } from '../providers/CachedMailProvider';

export function useMailProviders({ selectedAccountId }: { selectedAccountId: string }) {
  const { accounts: googleAccounts, getValidToken: getGoogleToken } = useGoogleAuth();
  const { accounts: exchangeAccounts, getValidToken: getExchangeToken } = useExchangeAuth();

  const allMailAccounts = useMemo(() => {
    const g = googleAccounts.map(a => ({ id: a.id, email: a.email, name: a.name || '', providerType: 'gmail' as const, color: (a as any).color }));
    const e = exchangeAccounts.map(a => ({ id: a.id, email: a.email, name: a.displayName || '', providerType: 'ews' as const, color: (a as any).color }));
    return [...g, ...e];
  }, [googleAccounts, exchangeAccounts]);

  const allProviders = useMemo(() => {
    const map = new Map<string, any>();
    for (const a of googleAccounts) {
      const p = new GmailMailProvider(a.id, getGoogleToken);
      map.set(a.id, new CachedMailProvider(p));
    }
    for (const a of exchangeAccounts) {
      const p = new EwsMailProvider(a.id, getExchangeToken);
      map.set(a.id, new CachedMailProvider(p));
    }
    return map;
  }, [googleAccounts, getGoogleToken, exchangeAccounts, getExchangeToken]);

  const provider = useMemo(() => {
    if (selectedAccountId === '__all__') return null;
    return allProviders.get(selectedAccountId) ?? null;
  }, [selectedAccountId, allProviders]);

  const resolveProvider = (accountId?: string) => {
    const targetId = accountId || selectedAccountId;
    if (targetId && targetId !== '__all__') return allProviders.get(targetId) ?? null;
    return provider;
  };

  return { allMailAccounts, allProviders, provider, resolveProvider };
}
