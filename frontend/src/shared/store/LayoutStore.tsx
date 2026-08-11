import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export type AppLayout = 'tabbed' | 'windows';
export type AppTab = 'calendar' | 'mail';

const STORAGE_KEY = 'calendar-desktop-layout';

interface LayoutContextValue {
  layout: AppLayout;
  setLayout: (l: AppLayout) => void;
  activeTab: AppTab;
  setActiveTab: (t: AppTab) => void;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [layout, setLayoutState] = useState<AppLayout>(
    () => (localStorage.getItem(STORAGE_KEY) as AppLayout) || 'tabbed'
  );
  const [activeTab, setActiveTabState] = useState<AppTab>('mail');

  useEffect(() => {
    if (!globalThis.history.state?.appTab) {
      globalThis.history.replaceState({ ...globalThis.history.state, appTab: activeTab }, '');
    }
    const onPopState = (event: PopStateEvent) => {
      const tab = event.state?.appTab;
      if (tab === 'calendar' || tab === 'mail') setActiveTabState(tab);
    };
    globalThis.addEventListener('popstate', onPopState);
    return () => globalThis.removeEventListener('popstate', onPopState);
  }, [activeTab]);

  const setActiveTab = (tab: AppTab) => {
    if (tab === activeTab) return;
    globalThis.history.pushState({ ...globalThis.history.state, appTab: tab }, '');
    setActiveTabState(tab);
  };

  const setLayout = (l: AppLayout) => {
    localStorage.setItem(STORAGE_KEY, l);
    setLayoutState(l);
  };

  return (
    <LayoutContext.Provider value={{ layout, setLayout, activeTab, setActiveTab }}>
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout() {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error('useLayout must be used within LayoutProvider');
  return ctx;
}
