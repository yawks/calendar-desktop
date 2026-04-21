import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { LayoutProvider, useLayout } from './shared/store/LayoutStore';

import AppTabs from './shared/components/AppTabs';
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

  // mode 'windows' : fenêtre dédiée au calendrier (mail via route /mail)
  return <CalendarPage />;
}

export default function App() {
  return (
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
                            <Route path="/mail" element={<MailApp />} />
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
  );
}
