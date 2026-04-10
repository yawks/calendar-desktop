import { createContext, useContext, useReducer, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { ExchangeAccount } from '../types';
import { invoke } from '@tauri-apps/api/core';

const STORAGE_KEY = 'calendar-desktop-exchange-accounts';

type Action =
  | { type: 'ADD'; payload: ExchangeAccount }
  | { type: 'REMOVE'; payload: string }
  | { type: 'UPDATE_TOKEN'; payload: { id: string; accessToken: string; expiresAt: number } }
  | { type: 'UPDATE_COLOR'; payload: { id: string; color: string } };

function reducer(state: ExchangeAccount[], action: Action): ExchangeAccount[] {
  switch (action.type) {
    case 'ADD':
      return [...state.filter((a) => a.id !== action.payload.id), action.payload];
    case 'REMOVE':
      return state.filter((a) => a.id !== action.payload);
    case 'UPDATE_TOKEN':
      return state.map((a) =>
        a.id === action.payload.id
          ? { ...a, accessToken: action.payload.accessToken, expiresAt: action.payload.expiresAt }
          : a
      );
    case 'UPDATE_COLOR':
      return state.map((a) =>
        a.id === action.payload.id ? { ...a, color: action.payload.color } : a
      );
  }
}

interface ExchangeAuthContextValue {
  accounts: ExchangeAccount[];
  addAccount: (account: ExchangeAccount) => void;
  removeAccount: (id: string) => void;
  updateAccountColor: (id: string, color: string) => void;
  /** Returns a valid access token, refreshing automatically if expired. */
  getValidToken: (accountId: string) => Promise<string | null>;
  /** Returns the stored refresh token (synchronous, no refresh). Used for Graph API calls. */
  getRefreshToken: (accountId: string) => string | null;
}

const ExchangeAuthContext = createContext<ExchangeAuthContextValue | null>(null);

export function ExchangeAuthProvider({ children }: { readonly children: ReactNode }) {
  const [accounts, dispatch] = useReducer(reducer, [], () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? (JSON.parse(stored) as ExchangeAccount[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
  }, [accounts]);

  const addAccount = useCallback((account: ExchangeAccount) => {
    dispatch({ type: 'ADD', payload: account });
  }, []);

  const removeAccount = useCallback((id: string) => {
    dispatch({ type: 'REMOVE', payload: id });
  }, []);

  const updateAccountColor = useCallback((id: string, color: string) => {
    dispatch({ type: 'UPDATE_COLOR', payload: { id, color } });
  }, []);

  const getValidToken = useCallback(async (accountId: string): Promise<string | null> => {
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return null;
    if (account.expiresAt > Date.now() + 60_000) return account.accessToken;

    // Refresh the token
    try {
      const result = await invoke<{ access_token: string; refresh_token?: string; expires_in: number }>(
        'ews_refresh_access_token',
        { refreshToken: account.refreshToken }
      );
      const expiresAt = Date.now() + result.expires_in * 1000;
      dispatch({ type: 'UPDATE_TOKEN', payload: { id: accountId, accessToken: result.access_token, expiresAt } });
      return result.access_token;
    } catch {
      return null;
    }
  }, [accounts]);

  const getRefreshToken = useCallback((accountId: string): string | null => {
    return accounts.find((a) => a.id === accountId)?.refreshToken ?? null;
  }, [accounts]);

  const contextValue = useMemo(
    () => ({ accounts, addAccount, removeAccount, updateAccountColor, getValidToken, getRefreshToken }),
    [accounts, addAccount, removeAccount, updateAccountColor, getValidToken, getRefreshToken]
  );

  return (
    <ExchangeAuthContext.Provider value={contextValue}>
      {children}
    </ExchangeAuthContext.Provider>
  );
}

export function useExchangeAuth() {
  const ctx = useContext(ExchangeAuthContext);
  if (!ctx) throw new Error('useExchangeAuth must be used within ExchangeAuthProvider');
  return ctx;
}

/** Decode the email and display name from an EWS JWT access token. */
export function parseExchangeToken(accessToken: string): { email: string; displayName: string } {
  try {
    const b64 = accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>;
    return {
      email: (payload.unique_name as string) ?? (payload.upn as string) ?? '',
      displayName: (payload.name as string) ?? '',
    };
  } catch {
    return { email: '', displayName: '' };
  }
}
