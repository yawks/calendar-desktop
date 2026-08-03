import { createContext, useContext, useState, ReactNode } from 'react';

const STORAGE_KEY = 'logodev-token';

interface LogoDevTokenContextValue {
  token: string;
  setToken: (t: string) => void;
}

const LogoDevTokenContext = createContext<LogoDevTokenContextValue | null>(null);

export function LogoDevTokenProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) ?? ''
  );

  const setToken = (t: string) => {
    localStorage.setItem(STORAGE_KEY, t);
    setTokenState(t);
  };

  return (
    <LogoDevTokenContext.Provider value={{ token, setToken }}>
      {children}
    </LogoDevTokenContext.Provider>
  );
}

export function useLogoDevToken() {
  const ctx = useContext(LogoDevTokenContext);
  if (!ctx) throw new Error('useLogoDevToken must be used within LogoDevTokenProvider');
  return ctx;
}
