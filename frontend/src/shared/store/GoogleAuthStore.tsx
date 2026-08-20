import { createContext, useContext, useReducer, useEffect, useCallback, useMemo, ReactNode, useRef } from 'react';
import { GoogleAccount } from '../types';
import { useVault } from '../security/VaultProvider';
import { hasNativeTransport, invokeNative } from '../api/nativeTransport';
import { connectNativeGoogle, usesNativeGoogleAuth } from '../api/nativeGoogleAuth';
import { clearConnectionIssue } from './ConnectionIssueStore';

const STORAGE_KEY = 'calendar-desktop-google-accounts';

type Action =
  | { type: 'ADD'; payload: GoogleAccount }
  | { type: 'REMOVE'; payload: string }
  | { type: 'UPDATE_TOKEN'; payload: { id: string; accessToken: string; expiresAt: number } }
  | { type: 'UPDATE_COLOR'; payload: { id: string; color: string } }
  | { type: 'UPDATE_CAPABILITIES'; payload: { id: string; enabledCapabilities: ('calendar' | 'email')[] } };

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
    case 'UPDATE_CAPABILITIES':
      return state.map((a) =>
        a.id === action.payload.id ? { ...a, enabledCapabilities: action.payload.enabledCapabilities } : a
      );
  }
}

interface GoogleAuthContextValue {
  accounts: GoogleAccount[];
  addAccount: (account: Omit<GoogleAccount, 'id'>) => GoogleAccount;
  removeAccount: (id: string) => void;
  updateAccountColor: (id: string, color: string) => void;
  updateAccountCapabilities: (id: string, enabledCapabilities: ('calendar' | 'email')[]) => void;
  /** Returns a valid access token, refreshing it automatically if expired. */
  getValidToken: (accountId: string) => Promise<string | null>;
  /** Opens the server-managed Google OAuth flow in a browser popup. */
  connectGoogle: (capabilities?: ('calendar' | 'email')[], credentials?: { clientId: string; clientSecret: string }) => Promise<GoogleAccount | null>;
}

const GoogleAuthContext = createContext<GoogleAuthContextValue | null>(null);

export function GoogleAuthProvider({ children }: { readonly children: ReactNode }) {
  const vault = useVault();
  const [accounts, dispatch] = useReducer(reducer, [], () => vault.read<GoogleAccount[]>(STORAGE_KEY, []));

  const accountsRef = useRef(accounts);
  useEffect(() => {
    accountsRef.current = accounts;
    vault.write(STORAGE_KEY, accounts);
  }, [accounts, vault]);

  const addAccount = useCallback((account: Omit<GoogleAccount, 'id'>): GoogleAccount => {
    const full: GoogleAccount = { ...account, id: account.email };
    dispatch({ type: 'ADD', payload: full });
    clearConnectionIssue(full.id);
    return full;
  }, []);

  const removeAccount = useCallback((id: string) => {
    dispatch({ type: 'REMOVE', payload: id });
  }, []);

  const updateAccountColor = useCallback((id: string, color: string) => {
    dispatch({ type: 'UPDATE_COLOR', payload: { id, color } });
  }, []);

  const updateAccountCapabilities = useCallback((id: string, enabledCapabilities: ('calendar' | 'email')[]) => {
    dispatch({ type: 'UPDATE_CAPABILITIES', payload: { id, enabledCapabilities } });
  }, []);

  const refreshPromises = useRef<Record<string, Promise<string | null>>>({});

  const getValidToken = useCallback(async (accountId: string): Promise<string | null> => {
    const account = accountsRef.current.find((a) => a.id === accountId);
    if (!account) return null;
    if (account.expiresAt > Date.now() + 60_000) return account.accessToken;

    const existing = refreshPromises.current[accountId];
    if (existing) return existing;

    const performRefresh = async () => {
        try {
            const payload = { refresh_token: account.refreshToken, client_id: account.googleClientId, client_secret: account.googleClientSecret };
            const refreshed = hasNativeTransport() ? await invokeNative<{ access_token: string; expires_at: number }>('google_auth_refresh', payload) : null;
            const res = refreshed ? null : await fetch('/auth/google/refresh', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            if (res && !res.ok) return null;
            const { access_token, expires_at } = refreshed ?? await res!.json() as { access_token: string; expires_at: number };
            dispatch({ type: 'UPDATE_TOKEN', payload: { id: accountId, accessToken: access_token, expiresAt: expires_at } });
            return access_token;
        } catch (err) {
          console.error('[GoogleAuthStore] refresh failed', err);
          const msg = err instanceof Error ? err.message.toLowerCase() : '';
          const isPermanent = msg.includes('unauthorized') || msg.includes('invalid_grant') || msg.includes('invalid_client');
          if (isPermanent) {
            // Mark token as expired far in the future to stop retrying; account needs re-auth
            dispatch({ type: 'UPDATE_TOKEN', payload: { id: accountId, accessToken: '', expiresAt: Date.now() + 30 * 60 * 1000 } });
          }
          return null;
        } finally {
            delete refreshPromises.current[accountId];
        }
    };

    refreshPromises.current[accountId] = performRefresh();
    return refreshPromises.current[accountId];
  }, []);

  const connectGoogle = useCallback(async (capabilities: ('calendar' | 'email')[] = ['calendar', 'email'], credentials?: { clientId: string; clientSecret: string }): Promise<GoogleAccount | null> => {
      if (usesNativeGoogleAuth()) {
        if (!credentials?.clientId || !credentials.clientSecret) return null;
        try {
          const account = await connectNativeGoogle(capabilities, credentials);
          return addAccount({ ...account, googleClientId: credentials.clientId, googleClientSecret: credentials.clientSecret });
        } catch (error) {
          console.error('[GoogleAuthStore] native authorization failed', error);
          throw error;
        }
      }
      const width = 500;
      const height = 650;
      const left = Math.round(window.screenX + (window.outerWidth - width) / 2);
      const top = Math.round(window.screenY + (window.outerHeight - height) / 2);
      // Open synchronously from the click handler so popup blockers allow it.
      const popup = window.open('', 'google-oauth', `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`);
      if (!popup) return null;
      try {
        const response = await fetch('/auth/google/prepare', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ capabilities, client_id: credentials?.clientId, client_secret: credentials?.clientSecret }),
        });
        if (!response.ok) { popup.close(); return null; }
        const { authorizationUrl } = await response.json() as { authorizationUrl: string };
        popup.location.href = authorizationUrl;
        return new Promise((resolve) => {
        const onMessage = (evt: MessageEvent) => {
          if (evt.origin !== window.location.origin) return;
          try {
            const data = typeof evt.data === 'string' ? JSON.parse(evt.data) : evt.data;
            if (data?.type === 'google-oauth-success' && data.account) {
              window.removeEventListener('message', onMessage);
              resolve(addAccount({ ...data.account, googleClientId: credentials?.clientId, googleClientSecret: credentials?.clientSecret } as Omit<GoogleAccount, 'id'>));
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
      } catch {
        popup.close();
        return null;
      }
  }, [addAccount]);

  const contextValue = useMemo(
    () => ({ accounts, addAccount, removeAccount, updateAccountColor, updateAccountCapabilities, getValidToken, connectGoogle }),
    [accounts, addAccount, removeAccount, updateAccountColor, updateAccountCapabilities, getValidToken, connectGoogle]
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
