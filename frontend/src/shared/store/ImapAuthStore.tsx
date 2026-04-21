import { createContext, useContext, useReducer, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { ImapAccount } from '../types';

const STORAGE_KEY = 'calendar-desktop-imap-accounts';

type Action =
  | { type: 'ADD'; payload: ImapAccount }
  | { type: 'REMOVE'; payload: string }
  | { type: 'UPDATE_COLOR'; payload: { id: string; color: string } }
  | { type: 'UPDATE_ACCOUNT'; payload: ImapAccount };

function reducer(state: ImapAccount[], action: Action): ImapAccount[] {
  switch (action.type) {
    case 'ADD':
      return [...state.filter((a) => a.id !== action.payload.id), action.payload];
    case 'REMOVE':
      return state.filter((a) => a.id !== action.payload);
    case 'UPDATE_COLOR':
      return state.map((a) =>
        a.id === action.payload.id ? { ...a, color: action.payload.color } : a
      );
    case 'UPDATE_ACCOUNT':
      return state.map((a) =>
        a.id === action.payload.id ? action.payload : a
      );
  }
}

interface ImapAuthContextValue {
  accounts: ImapAccount[];
  addAccount: (account: ImapAccount) => void;
  removeAccount: (id: string) => void;
  updateAccountColor: (id: string, color: string) => void;
  updateAccount: (account: ImapAccount) => void;
}

const ImapAuthContext = createContext<ImapAuthContextValue | null>(null);

export function ImapAuthProvider({ children }: { readonly children: ReactNode }) {
  const [accounts, dispatch] = useReducer(reducer, [], () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? (JSON.parse(stored) as ImapAccount[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
  }, [accounts]);

  const addAccount = useCallback((account: ImapAccount) => {
    dispatch({ type: 'ADD', payload: account });
  }, []);

  const removeAccount = useCallback((id: string) => {
    dispatch({ type: 'REMOVE', payload: id });
  }, []);

  const updateAccountColor = useCallback((id: string, color: string) => {
    dispatch({ type: 'UPDATE_COLOR', payload: { id, color } });
  }, []);

  const updateAccount = useCallback((account: ImapAccount) => {
    dispatch({ type: 'UPDATE_ACCOUNT', payload: account });
  }, []);

  const contextValue = useMemo(
    () => ({ accounts, addAccount, removeAccount, updateAccountColor, updateAccount }),
    [accounts, addAccount, removeAccount, updateAccountColor, updateAccount]
  );

  return (
    <ImapAuthContext.Provider value={contextValue}>
      {children}
    </ImapAuthContext.Provider>
  );
}

export function useImapAuth() {
  const ctx = useContext(ImapAuthContext);
  if (!ctx) throw new Error('useImapAuth must be used within ImapAuthProvider');
  return ctx;
}
