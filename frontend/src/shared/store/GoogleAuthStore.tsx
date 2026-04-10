import { createContext, useContext, useReducer, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { GoogleAccount } from '../types';
import { isTauri, tauriConnectGoogle, refreshAccessToken } from '../utils/tauriOAuth';
import { resolveGoogleCredentials } from './googleClientConfig';

const STORAGE_KEY = 'calendar-desktop-google-accounts';

type Action =
  | { type: 'ADD'; payload: GoogleAccount }
  | { type: 'REMOVE'; payload: string }
  | { type: 'UPDATE_TOKEN'; payload: { id: string; accessToken: string; expiresAt: number } }
  | { type: 'UPDATE_COLOR'; payload: { id: string; color: string } };

function reducer(state: GoogleAccount[], action: Action): GoogleAccount[] {
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

interface GoogleAuthContextValue {
  accounts: GoogleAccount[];
  addAccount: (account: Omit<GoogleAccount, 'id'>) => GoogleAccount;
  removeAccount: (id: string) => void;
  updateAccountColor: (id: string, color: string) => void;
  /** Returns a valid access token, refreshing it automatically if expired. */
  getValidToken: (accountId: string) => Promise<string | null>;
  /** Opens Google OAuth (Tauri: system browser + PKCE; Web: popup + proxy). */
  connectGoogle: () => Promise<GoogleAccount | null>;
}

const GoogleAuthContext = createContext<GoogleAuthContextValue | null>(null);

export function GoogleAuthProvider({ children }: { readonly children: ReactNode }) {
  const [accounts, dispatch] = useReducer(reducer, [], () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? (JSON.parse(stored) as GoogleAccount[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
  }, [accounts]);

  const addAccount = useCallback((account: Omit<GoogleAccount, 'id'>): GoogleAccount => {
    const full: GoogleAccount = { ...account, id: account.email };
    dispatch({ type: 'ADD', payload: full });
    return full;
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
    if (account.expiresAt > Date.now()) return account.accessToken;

    // Refresh the token
    try {
      if (isTauri()) {
        // Desktop: PKCE flow — no client_secret, refresh directly with Google
        const { clientId, clientSecret } = resolveGoogleCredentials();
        const { accessToken, expiresAt } = await refreshAccessToken(account.refreshToken, clientId, clientSecret);
        dispatch({ type: 'UPDATE_TOKEN', payload: { id: accountId, accessToken, expiresAt } });
        return accessToken;
      } else {
        // Web: proxy keeps client_secret server-side
        const res = await fetch('/auth/google/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: account.refreshToken }),
        });
        if (!res.ok) return null;
        const { access_token, expires_at } = await res.json() as { access_token: string; expires_at: number };
        dispatch({ type: 'UPDATE_TOKEN', payload: { id: accountId, accessToken: access_token, expiresAt: expires_at } });
        return access_token;
      }
    } catch {
      return null;
    }
  }, [accounts]);

  const connectGoogle = useCallback(async (): Promise<GoogleAccount | null> => {
    if (isTauri()) {
      // Native flow: system browser + local HTTP server + PKCE
      const accountData = await tauriConnectGoogle();
      if (!accountData) return null;
      return addAccount(accountData);
    } else {
      // Web flow: OAuth popup via proxy
      return new Promise((resolve) => {
        const width = 500;
        const height = 650;
        const left = Math.round(window.screenX + (window.outerWidth - width) / 2);
        const top = Math.round(window.screenY + (window.outerHeight - height) / 2);
        const popup = window.open(
          '/auth/google',
          'google-oauth',
          `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`
        );

        if (!popup) { resolve(null); return; }

        const onMessage = (evt: MessageEvent) => {
          try {
            const data = typeof evt.data === 'string' ? JSON.parse(evt.data) : evt.data;
            if (data?.type === 'google-oauth-success' && data.account) {
              window.removeEventListener('message', onMessage);
              resolve(addAccount(data.account as Omit<GoogleAccount, 'id'>));
            } else if (data?.type === 'google-oauth-error') {
              window.removeEventListener('message', onMessage);
              resolve(null);
            }
          } catch { /* ignore unrelated messages */ }
        };

        window.addEventListener('message', onMessage);
        const poll = setInterval(() => {
          if (popup.closed) {
            clearInterval(poll);
            window.removeEventListener('message', onMessage);
            resolve(null);
          }
        }, 500);
      });
    }
  }, [addAccount]);

  const contextValue = useMemo(
    () => ({ accounts, addAccount, removeAccount, updateAccountColor, getValidToken, connectGoogle }),
    [accounts, addAccount, removeAccount, updateAccountColor, getValidToken, connectGoogle]
  );

  return (
    <GoogleAuthContext.Provider value={contextValue}>
      {children}
    </GoogleAuthContext.Provider>
  );
}

export function useGoogleAuth() {
  const ctx = useContext(GoogleAuthContext);
  if (!ctx) throw new Error('useGoogleAuth must be used within GoogleAuthProvider');
  return ctx;
}
