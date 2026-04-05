import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import fr from './locales/fr/translation.json';
import en from './locales/en/translation.json';

export const LANGUAGE_STORAGE_KEY = 'calendar-desktop-language';

export type LanguagePreference = 'system' | 'fr' | 'en';

export function getSystemLanguage(): 'fr' | 'en' {
  return navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

function getInitialLanguage(): string {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY) as LanguagePreference | null;
  if (stored === 'fr' || stored === 'en') return stored;
  return getSystemLanguage();
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      fr: { translation: fr },
      en: { translation: en },
    },
    lng: getInitialLanguage(),
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });

export default i18n;
