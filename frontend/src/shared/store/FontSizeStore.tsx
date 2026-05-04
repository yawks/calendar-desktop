import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type FontSizePreference = 'small' | 'medium' | 'large';

const STORAGE_KEY = 'calendar-desktop-font-size';

function applyFontSize(size: FontSizePreference) {
  document.documentElement.setAttribute('data-font-size', size);
}

interface FontSizeContextValue {
  fontSize: FontSizePreference;
  setFontSize: (s: FontSizePreference) => void;
}

const FontSizeContext = createContext<FontSizeContextValue | null>(null);

export function FontSizeProvider({ children }: { children: ReactNode }) {
  const [fontSize, setFontSizeState] = useState<FontSizePreference>(
    () => (localStorage.getItem(STORAGE_KEY) as FontSizePreference) || 'medium'
  );

  const setFontSize = (s: FontSizePreference) => {
    localStorage.setItem(STORAGE_KEY, s);
    setFontSizeState(s);
    applyFontSize(s);
  };

  useEffect(() => {
    applyFontSize(fontSize);
  }, [fontSize]);

  return (
    <FontSizeContext.Provider value={{ fontSize, setFontSize }}>
      {children}
    </FontSizeContext.Provider>
  );
}

export function useFontSize() {
  const ctx = useContext(FontSizeContext);
  if (!ctx) throw new Error('useFontSize must be used within FontSizeProvider');
  return ctx;
}
