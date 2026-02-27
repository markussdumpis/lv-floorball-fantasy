import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import en from './en.json';
import lv from './lv.json';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

export type AppLanguage = 'en' | 'lv';

export const APP_LANGUAGE_STORAGE_KEY = 'app_language';

const resources = {
  en: { translation: en },
  lv: { translation: lv },
} as const;

let initPromise: Promise<void> | null = null;

function normalizeLanguage(value: unknown): AppLanguage | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('lv')) return 'lv';
  if (normalized.startsWith('en')) return 'en';
  return null;
}

async function detectInitialLanguage(): Promise<AppLanguage> {
  try {
    const stored = await AsyncStorage.getItem(APP_LANGUAGE_STORAGE_KEY);
    const parsed = normalizeLanguage(stored);
    if (parsed) return parsed;
  } catch {
    // ignore storage read errors
  }

  const locale =
    Localization.getLocales?.()[0]?.languageTag ??
    Localization.getLocales?.()[0]?.languageCode ??
    'en';
  return String(locale).toLowerCase().startsWith('lv') ? 'lv' : 'en';
}

async function persistLanguageToProfile(lang: AppLanguage) {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.getSession();
    if (error) return;
    const userId = data.session?.user?.id;
    if (!userId) return;

    await supabase.from('profiles').upsert({ id: userId, language: lang }, { onConflict: 'id' });
  } catch {
    // ignore profile update failures for language changes
  }
}

export async function initI18n() {
  if (i18n.isInitialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const initialLanguage = await detectInitialLanguage();
    await i18n.use(initReactI18next).init({
      resources,
      lng: initialLanguage,
      fallbackLng: 'en',
      compatibilityJSON: 'v4',
      interpolation: { escapeValue: false },
    });
  })();

  return initPromise;
}

export function getCurrentAppLanguage(): AppLanguage {
  const parsed = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language);
  return parsed ?? 'en';
}

export async function setAppLanguage(lang: AppLanguage) {
  if (!i18n.isInitialized) {
    await initI18n();
  }

  const current = getCurrentAppLanguage();
  if (current !== lang) {
    await i18n.changeLanguage(lang);
  }

  await AsyncStorage.setItem(APP_LANGUAGE_STORAGE_KEY, lang);
  await persistLanguageToProfile(lang);
}

export async function syncLanguageFromProfile(userId?: string | null) {
  if (!userId || !isSupabaseConfigured()) return;
  if (!i18n.isInitialized) {
    await initI18n();
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('profiles')
      .select('language')
      .eq('id', userId)
      .maybeSingle();

    if (error) return;
    const profileLang = normalizeLanguage(data?.language);
    if (!profileLang) return;
    await setAppLanguage(profileLang);
  } catch {
    // ignore profile read failures
  }
}

export default i18n;
