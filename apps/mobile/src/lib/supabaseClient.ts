import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;
let hasLoggedConfig = false;

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

  if (!hasLoggedConfig) {
    const anonPreview = `${anon.slice(0, 6)}…`;
    console.log('[Supabase] createClient', { url, anonKey: anonPreview });
    hasLoggedConfig = true;
  }

  client = createClient(url, anon, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    global: {
      fetch: fetchWithTimeout,
    },
  });
  console.log('[auth] client ready persistSession=true storage=AsyncStorage');
  console.log('[debug] __DEV__ =', __DEV__);

  const runUserTeamPointsLeakTest = async (storageKey: string) => {
    console.log('[leaktest] start user_team_points_view');
    try {
      const stored = await AsyncStorage.getItem(storageKey);
      if (!stored) {
        console.log('[leaktest] skip', { reason: 'no stored auth blob' });
        return;
      }

      let parsed: any = null;
      try {
        parsed = JSON.parse(stored);
      } catch {
        parsed = null;
        console.log('[leaktest] skip', { reason: 'parse failed' });
        return;
      }

      const value = parsed?.value ?? parsed ?? {};
      const token =
        value?.access_token ??
        value?.currentSession?.access_token ??
        value?.session?.access_token ??
        value?.user?.access_token;

      if (!token) {
        console.log('[leaktest] skip', { reason: 'no token' });
        return;
      }

      const requestUrl = `${url}/rest/v1/user_team_points_view?select=*&limit=50`;
      console.log('[leaktest] fetch start', { url: requestUrl });
      const controller = new AbortController();
      const abortTimeout = setTimeout(() => controller.abort(), 10_000);

      let resp: Response | null = null;
      try {
        resp = await fetch(requestUrl, {
          headers: {
            apikey: anon,
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          signal: controller.signal,
        });
      } catch (fetchErr) {
        throw fetchErr;
      } finally {
        clearTimeout(abortTimeout);
      }

      if (!resp.ok) {
        console.log('[leaktest] fetch status', resp.status);
        try {
          const text = await resp.text();
          console.log('[leaktest] fetch error body', text.slice(0, 200));
        } catch (bodyErr) {
          console.log('[leaktest] fetch error body', 'unavailable');
        }
        return;
      }
      console.log('[leaktest] fetch status', resp.status);

      const bodyText = await resp.text();
      console.log('[leaktest] bodyText', { len: bodyText.length, preview: bodyText.slice(0, 120) });

      let rows: any[] = [];
      try {
        rows = bodyText ? JSON.parse(bodyText) : [];
      } catch (e) {
        console.log('[leaktest] json parse error', String(e));
        rows = [];
      }

      const count = Array.isArray(rows) ? rows.length : 0;
      const firstKeys =
        count > 0 && typeof rows[0] === 'object' ? Object.keys(rows[0]).slice(0, 10) : [];
      const uniqueIds = new Set<string>();
      if (Array.isArray(rows)) {
        for (const row of rows) {
          const candidate = row?.user_id ?? row?.owner_id;
          if (candidate) {
            uniqueIds.add(String(candidate));
            if (uniqueIds.size >= 3) break;
          }
        }
      }

      const teamIds =
        Array.isArray(rows) && rows.length
          ? [...new Set(rows.map(r => r?.fantasy_team_id).filter(Boolean))]
          : [];

      let currentUserId: string | null = null;
      try {
        const { data: userData } = await client.auth.getUser();
        currentUserId = userData?.user?.id ?? null;
      } catch (e) {
        console.log('[leaktest] currentUser error', String(e));
      }

      const ownerFields = ['user_id', 'owner_id', 'profile_id', 'created_by', 'manager_id'];
      const ownerFieldsPresent: Array<{ field: string; values: string[] }> = [];
      if (Array.isArray(rows)) {
        for (const field of ownerFields) {
          const values = new Set<string>();
          for (const row of rows) {
            const value = row?.[field];
            if (value) {
              values.add(String(value));
              if (values.size >= 5) break;
            }
          }
          if (values.size > 0) {
            ownerFieldsPresent.push({ field, values: Array.from(values) });
          }
        }
      }

      console.log('[leaktest] currentUser', { id: currentUserId });
      console.log('[leaktest] teamIds', teamIds.slice(0, 20));
      console.log('[leaktest] ownerFieldsPresent', ownerFieldsPresent);
      console.log('[leaktest] done', {
        rows: count,
        firstKeys: firstKeys.slice(0, 10),
      });
      console.log('[leaktest] user_team_points_view', {
        rows: count,
        ids: Array.from(uniqueIds),
        firstKeys,
      });
    } catch (err) {
      console.log('[leaktest] error', String(err));
    } finally {
      console.log('[leaktest] finished');
    }
  };

  if (__DEV__) {
    const projectRef = new URL(url).hostname.split('.')[0];
    const storageKey = `sb-${projectRef}-auth-token`;
    const slowLogTimeout = setTimeout(() => console.log('[debug] storage read slow'), 2000);

    AsyncStorage.getItem(storageKey)
      .then(stored => {
        clearTimeout(slowLogTimeout);
        if (!stored) {
          console.log('[debug] no stored token', { storageKey });
          return;
        }

        let parsed: any = null;
        try {
          parsed = JSON.parse(stored);
        } catch {
          parsed = null;
        }

        const value = parsed?.value ?? parsed ?? {};
        const token =
          value?.access_token ??
          value?.currentSession?.access_token ??
          value?.session?.access_token ??
          value?.user?.access_token;
        const userId =
          value?.user?.id ??
          value?.currentSession?.user?.id ??
          value?.session?.user?.id ??
          null;

        if (token) {
          console.log('[debug] storage auth token', {
            storageKey,
            tokenPrefix: `${token.slice(0, 20)}...`,
            tokenLen: token.length,
            hasUser: Boolean(userId),
          });
        } else {
          console.log('[debug] no stored token', { storageKey });
        }
      })
      .catch(err => {
        clearTimeout(slowLogTimeout);
        console.log('[debug] storage read error', String(err));
      });

    console.log('[auth] getSession start');
    client.auth
      .getSession()
      .then(({ data }) => {
        const token = data.session?.access_token;
        console.log('[auth] getSession resolved', {
          hasSession: !!data.session,
          tokenPrefix: token ? `${token.slice(0, 20)}...` : null,
          tokenLen: token?.length ?? 0,
        });
      })
      .catch(e => console.log('[auth] getSession error', String(e)));

    console.log('[leaktest] scheduled');
    setTimeout(() => {
      runUserTeamPointsLeakTest(storageKey);
    }, 500);
  }

  return client;
}
