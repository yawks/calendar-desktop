import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { queryClient, indexedDBPersister } from './shared/queryClient';
import { LayoutProvider, useLayout } from './shared/store/LayoutStore';

import AppTabs from './shared/components/AppTabs';
import WindowSwitcher from './shared/components/WindowSwitcher';
import { CalendarGroupProvider } from './features/calendar/store/CalendarGroupStore';
import CalendarPage from './features/calendar/CalendarPage';
import { CalendarProvider } from './features/calendar/store/CalendarStore';
import ConfigPage from './pages/ConfigPage';
import { ExchangeAuthProvider } from './shared/store/ExchangeAuthStore';
import { GoogleAuthProvider } from './shared/store/GoogleAuthStore';
import { ImapAuthProvider } from './shared/store/ImapAuthStore';
import { JmapAuthProvider } from './shared/store/JmapAuthStore';
import { LanguageProvider } from './shared/store/LanguageStore';
import MailApp from './features/mail/MailPage';
import { TagProvider } from './features/calendar/store/TagStore';
import { ThemeProvider } from './shared/store/ThemeStore';

// Fenêtre calendrier secondaire (mode windows uniquement, route /calendar)
function CalendarWindowView() {
  return (
    <>
      <WindowSwitcher target="mail" />
      <CalendarPage />
    </>
  );
}

function RootView() {
  const { layout, activeTab, setActiveTab } = useLayout();

  if (layout === 'tabbed') {
    return (
      <>
        <AppTabs active={activeTab} onChange={setActiveTab} />
        {activeTab === 'calendar' ? <CalendarPage /> : <MailApp />}
      </>
    );
  }

  // mode 'windows' : fenêtre principale = Mail, bouton pour ouvrir/focus le Calendrier
  return (
    <>
      <WindowSwitcher target="calendar" />
      <MailApp />
    </>
  );
}

export default function App() {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: indexedDBPersister }}
    >
      <ThemeProvider>
        <LanguageProvider>
          <LayoutProvider>
            <GoogleAuthProvider>
              <ExchangeAuthProvider>
                <JmapAuthProvider>
                  <ImapAuthProvider>
                    <CalendarProvider>
                      <CalendarGroupProvider>
                        <TagProvider>
                          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                            <Routes>
                              <Route path="/" element={<RootView />} />
                              <Route path="/calendar" element={<CalendarWindowView />} />
                              <Route path="/config" element={<ConfigPage />} />
                            </Routes>
                          </BrowserRouter>
                        </TagProvider>
                      </CalendarGroupProvider>
                    </CalendarProvider>
                  </ImapAuthProvider>
                </JmapAuthProvider>
              </ExchangeAuthProvider>
            </GoogleAuthProvider>
          </LayoutProvider>
        </LanguageProvider>
      </ThemeProvider>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </PersistQueryClientProvider>
  );
}
