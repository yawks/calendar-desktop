import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { CalendarProvider } from './store/CalendarStore';
import { CalendarGroupProvider } from './store/CalendarGroupStore';
import { TagProvider } from './store/TagStore';
import { ThemeProvider } from './store/ThemeStore';
import { LanguageProvider } from './store/LanguageStore';
import { GoogleAuthProvider } from './store/GoogleAuthStore';
import { ExchangeAuthProvider } from './store/ExchangeAuthStore';
import { LayoutProvider, useLayout } from './store/LayoutStore';
import CalendarPage from './pages/CalendarPage';
import ConfigPage from './pages/ConfigPage';
import MailApp from './apps/MailApp';
import AppTabs from './components/AppTabs';

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
          </ExchangeAuthProvider>
          </GoogleAuthProvider>
        </LayoutProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
