import { createContext, useContext, useReducer, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { JmapAccount } from '../types';

const STORAGE_KEY = 'calendar-desktop-jmap-accounts';

type Action =
  | { type: 'ADD'; payload: JmapAccount }
  | { type: 'REMOVE'; payload: string }
  | { type: 'UPDATE_COLOR'; payload: { id: string; color: string } }
  | { type: 'UPDATE_ACCOUNT'; payload: JmapAccount };

function reducer(state: JmapAccount[], action: Action): JmapAccount[] {
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

interface JmapAuthContextValue {
  accounts: JmapAccount[];
  addAccount: (account: JmapAccount) => void;
  removeAccount: (id: string) => void;
  updateAccountColor: (id: string, color: string) => void;
  updateAccount: (account: JmapAccount) => void;
}

const JmapAuthContext = createContext<JmapAuthContextValue | null>(null);

export function JmapAuthProvider({ children }: { readonly children: ReactNode }) {
  const [accounts, dispatch] = useReducer(reducer, [], () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? (JSON.parse(stored) as JmapAccount[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
  }, [accounts]);

  const addAccount = useCallback((account: JmapAccount) => {
    dispatch({ type: 'ADD', payload: account });
  }, []);

  const removeAccount = useCallback((id: string) => {
    dispatch({ type: 'REMOVE', payload: id });
  }, []);

  const updateAccountColor = useCallback((id: string, color: string) => {
    dispatch({ type: 'UPDATE_COLOR', payload: { id, color } });
  }, []);

  const updateAccount = useCallback((account: JmapAccount) => {
    dispatch({ type: 'UPDATE_ACCOUNT', payload: account });
  }, []);

  const contextValue = useMemo(
    () => ({ accounts, addAccount, removeAccount, updateAccountColor, updateAccount }),
    [accounts, addAccount, removeAccount, updateAccountColor, updateAccount]
  );

  return (
    <JmapAuthContext.Provider value={contextValue}>
      {children}
    </JmapAuthContext.Provider>
  );
}

export function useJmapAuth() {
  const ctx = useContext(JmapAuthContext);
  if (!ctx) throw new Error('useJmapAuth must be used within JmapAuthProvider');
  return ctx;
}
