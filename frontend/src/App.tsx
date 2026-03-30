import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { CalendarProvider } from './store/CalendarStore';
import { CalendarGroupProvider } from './store/CalendarGroupStore';
import { ThemeProvider } from './store/ThemeStore';
import { LanguageProvider } from './store/LanguageStore';
import { GoogleAuthProvider } from './store/GoogleAuthStore';
import CalendarPage from './pages/CalendarPage';
import ConfigPage from './pages/ConfigPage';

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
      <GoogleAuthProvider>
        <CalendarProvider>
        <CalendarGroupProvider>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Routes>
              <Route path="/" element={<CalendarPage />} />
              <Route path="/config" element={<ConfigPage />} />
            </Routes>
          </BrowserRouter>
        </CalendarGroupProvider>
        </CalendarProvider>
      </GoogleAuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
