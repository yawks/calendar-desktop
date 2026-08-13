import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';

export interface OfflineMailSettings {
  enabled: boolean;
  maxThreads: number;
  maxAgeDays: number;
}

const STORAGE_KEY = 'offline-mail-settings-v1';
const DEFAULT_SETTINGS: OfflineMailSettings = { enabled: false, maxThreads: 100, maxAgeDays: 30 };

function loadSettings(): OfflineMailSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<OfflineMailSettings> | null;
    return stored ? { ...DEFAULT_SETTINGS, ...stored } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface OfflineMailContextValue {
  settings: OfflineMailSettings;
  updateSettings: (patch: Partial<OfflineMailSettings>) => void;
}

const OfflineMailContext = createContext<OfflineMailContextValue | null>(null);

export function OfflineMailProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(loadSettings);
  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)), [settings]);
  const value = useMemo(() => ({
    settings,
    updateSettings: (patch: Partial<OfflineMailSettings>) => setSettings(current => ({ ...current, ...patch })),
  }), [settings]);
  return <OfflineMailContext.Provider value={value}>{children}</OfflineMailContext.Provider>;
}

export function useOfflineMailSettings() {
  const context = useContext(OfflineMailContext);
  if (!context) throw new Error('useOfflineMailSettings must be used inside OfflineMailProvider');
  return context;
}
