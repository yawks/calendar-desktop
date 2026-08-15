import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { OfflineMailProvider } from './shared/store/OfflineMailStore';
import { MailNotificationProvider } from './shared/store/MailNotificationStore';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { queryClient, indexedDBPersister } from './shared/queryClient';
import { LayoutProvider, useLayout } from './shared/store/LayoutStore';
import { FontSizeProvider } from './shared/store/FontSizeStore';
import { SignatureProvider } from './shared/store/SignatureStore';

import { CalendarGroupProvider } from './features/calendar/store/CalendarGroupStore';
import CalendarPage from './features/calendar/CalendarPage';
import { CalendarProvider } from './features/calendar/store/CalendarStore';
import ConfigPage from './pages/ConfigPage';
import { ExchangeAuthProvider } from './shared/store/ExchangeAuthStore';
import { GoogleAuthProvider } from './shared/store/GoogleAuthStore';
import { ImapAuthProvider } from './shared/store/ImapAuthStore';
import { JmapAuthProvider } from './shared/store/JmapAuthStore';
import { LanguageProvider } from './shared/store/LanguageStore';
import { LogoDevTokenProvider } from './shared/store/LogoDevTokenStore';
import MailApp from './features/mail/MailPage';
import { TagProvider } from './features/calendar/store/TagStore';
import { ThemeProvider } from './shared/store/ThemeStore';
import WelcomeScreen from './shared/components/WelcomeScreen';
import { useAppCapabilities } from './shared/hooks/useAppCapabilities';
import { NativeDeepLinks } from './shared/platform/NativeDeepLinks';
import { VaultProvider } from './shared/security/VaultProvider';

// Fenêtre calendrier secondaire (mode windows uniquement, route /calendar)
function CalendarWindowView() {
  const { hasSource, hasCalendar } = useAppCapabilities();

  if (!hasSource) return <WelcomeScreen />;

  return (
    hasCalendar ? <CalendarPage /> : <MailApp />
  );
}

function RootView() {
  const { layout, activeTab } = useLayout();
  const { hasSource, hasCalendar, hasMail } = useAppCapabilities();

  if (!hasSource) return <WelcomeScreen />;

  if (layout === 'tabbed') {
    const visibleTab = activeTab === 'calendar' && hasCalendar
      ? 'calendar'
      : activeTab === 'mail' && hasMail
        ? 'mail'
        : hasCalendar ? 'calendar' : 'mail';

    return visibleTab === 'calendar' ? <CalendarPage /> : <MailApp />;
  }

  // En mode fenêtres, la fenêtre principale privilégie le mail lorsqu'il est disponible.
  return hasMail ? <MailApp /> : <CalendarPage />;
}

export default function App() {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: indexedDBPersister, buster: 'mail-provider-loading-v4' }}
    >
      <ThemeProvider>
      <OfflineMailProvider>
      <VaultProvider>
        <LanguageProvider>
        <MailNotificationProvider>
          <FontSizeProvider>
            <SignatureProvider>
            <LogoDevTokenProvider>
            <LayoutProvider>
            <GoogleAuthProvider>
              <ExchangeAuthProvider>
                <JmapAuthProvider>
                  <ImapAuthProvider>
                    <CalendarProvider>
                      <CalendarGroupProvider>
                        <TagProvider>
                          <BrowserRouter>
                            <NativeDeepLinks />
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
            </LogoDevTokenProvider>
            </SignatureProvider>
          </FontSizeProvider>
        </MailNotificationProvider>
      </LanguageProvider>
      </VaultProvider>
      </OfflineMailProvider>
      </ThemeProvider>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </PersistQueryClientProvider>
  );
}
