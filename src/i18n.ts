/**
 * i18n configuration for LogviewR
 * Supported: fr, en
 *
 * Language priority:
 * - If the user has explicitly chosen a language (saved in localStorage), that value is used
 *   and the browser language is ignored.
 * - Otherwise the browser language (navigator.language) is used, restricted to fr or en;
 *   if the browser language is not supported, fallback to French.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import fr from './locales/fr.json';
import en from './locales/en.json';

const supportedLngs = ['fr', 'en'];

function getBrowserLanguage(): string {
  if (typeof navigator === 'undefined') return 'fr';
  const lang = navigator.language || (navigator as any).userLanguage;
  if (!lang) return 'fr';
  const code = lang.slice(0, 2).toLowerCase();
  return supportedLngs.includes(code) ? code : 'fr';
}

/** localStorage key for user's language choice. When set, browser language is not used. */
const STORAGE_KEY = 'logviewr_lang';

function getInitialLanguage(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && supportedLngs.includes(stored)) return stored;
  } catch (_) {}
  return getBrowserLanguage();
}

i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    en: { translation: en }
  },
  lng: getInitialLanguage(),
  fallbackLng: 'fr',
  supportedLngs,
  interpolation: {
    escapeValue: false // React already escapes
  }
});

// Expose method to change language and persist
export function setAppLanguage(lng: string): void {
  if (supportedLngs.includes(lng)) {
    i18n.changeLanguage(lng);
    try {
      localStorage.setItem(STORAGE_KEY, lng);
    } catch (_) {}
  }
}

export function getAppLanguage(): string {
  return i18n.language || getInitialLanguage();
}

export default i18n;
