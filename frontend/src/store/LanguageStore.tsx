import { createContext, useContext, useState, ReactNode } from 'react';
import i18n, { LANGUAGE_STORAGE_KEY, LanguagePreference, getSystemLanguage } from '../i18n';

interface LanguageContextValue {
  preference: LanguagePreference;
  setPreference: (p: LanguagePreference) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY) as LanguagePreference | null;
  const [preference, setPreferenceState] = useState<LanguagePreference>(
    stored === 'fr' || stored === 'en' || stored === 'system' ? stored : 'system'
  );

  const setPreference = (p: LanguagePreference) => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, p);
    setPreferenceState(p);
    i18n.changeLanguage(p === 'system' ? getSystemLanguage() : p);
  };

  return (
    <LanguageContext.Provider value={{ preference, setPreference }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
