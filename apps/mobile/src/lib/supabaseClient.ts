import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export const missingConfigMessage =
  'Supabase environment variables are missing. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.';

export function getSupabaseEnv() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(missingConfigMessage);
  }
  return { url, anon };
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  ms = 15_000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);
  const started = Date.now();

  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    if (__DEV__) {
      console.log(
        `[supabase fetch] ${method} ${url} -> ${response.status} in ${Date.now() - started}ms`
      );
    }
    return response;
  } catch (error: any) {
    if (__DEV__) {
      console.log(
        `[supabase fetch] ${method} ${url} -> ${error?.name ?? 'error'} in ${Date.now() - started}ms`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function isSupabaseConfigured() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  return Boolean(url && anon);
}

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const { url, anon } = getSupabaseEnv();

  const createdClient = createClient(url, anon, {
    auth: {
      storage: AsyncStorage,
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
    global: {
      fetch: fetchWithTimeout,
    },
  });
  client = createdClient;

  return client;
}
