import AsyncStorage from '@react-native-async-storage/async-storage';
import { DIAGNOSTICS_LOGGING, recordApiError, diagLog } from './diagnostics';

export function getSupabaseEnv() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Config missing: EXPO_PUBLIC_SUPABASE_URL/ANON_KEY');
  }
  return { url, anonKey };
}

function getAuthStorageKey(url: string) {
  const projectRef = new URL(url).hostname.split('.')[0];
  return `sb-${projectRef}-auth-token`;
}

let lastLoggedAuthState: { hasToken: boolean; hasUser: boolean } | null = null;

export async function getStoredSession(): Promise<{
  storageKey: string;
  raw: string | null;
  token: string | null;
  userId: string | null;
}> {
  const { url } = getSupabaseEnv();
  const storageKey = getAuthStorageKey(url);
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) {
    return { storageKey, raw: null, token: null, userId: null };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('AUTH_STORAGE_CORRUPT');
  }

  const token =
    parsed?.access_token ??
    parsed?.currentSession?.access_token ??
    parsed?.session?.access_token ??
    null;
  const userId =
    parsed?.user?.id ??
    parsed?.currentSession?.user?.id ??
    parsed?.session?.user?.id ??
    null;

  const hasToken = !!token;
  const hasUser = !!userId;
  const stateChanged =
    !lastLoggedAuthState ||
    lastLoggedAuthState.hasToken !== hasToken ||
    lastLoggedAuthState.hasUser !== hasUser;
  if (stateChanged && (DIAGNOSTICS_LOGGING || __DEV__)) {
    diagLog('auth_storage_state', { storageKey, hasToken, hasUser });
    lastLoggedAuthState = { hasToken, hasUser };
  }
  return { storageKey, raw, token, userId };
}

export async function getAccessTokenFromStorage(): Promise<string> {
  const { token } = await getStoredSession();
  if (!token) throw new Error('NOT_SIGNED_IN');
  return token;
}

export function isOfflineError(err: any): boolean {
  const msg = (err?.message ?? '').toString().toLowerCase();
  if (msg.includes('network request failed')) return true;
  if (msg.includes('failed to fetch')) return true;
  if (err?.name === 'TypeError' && msg.includes('network')) return true;
  return false;
}

export async function forceLocalSignOut() {
  const { url } = getSupabaseEnv();
  const ref = new URL(url).hostname.split('.')[0];
  await AsyncStorage.removeItem(`sb-${ref}-auth-token`);
  await AsyncStorage.removeItem(`sb-${ref}-auth-token-code-verifier`).catch(() => {});
  console.log('[auth] local signout cleared');
}

export async function buildHeaders(options: { requireAuth?: boolean } = {}) {
  const { anonKey } = getSupabaseEnv();
  const requireAuth = options.requireAuth ?? false;
  let token: string | null = null;
  if (requireAuth) {
    token = await getAccessTokenFromStorage();
    if (!token) throw new Error('NOT_SIGNED_IN');
  }

  const headers: Record<string, string> = {
    apikey: anonKey,
    Accept: 'application/json',
  };
  if (requireAuth) {
    headers.Authorization = `Bearer ${token}`;
  } else {
    headers.Authorization = `Bearer ${anonKey}`;
  }
  return headers;
}

type FetchJsonOptions = {
  requireAuth?: boolean;
  method?: string;
  body?: any;
  query?: Record<string, string | number | undefined | null>;
  timeoutMs?: number;
  headers?: Record<string, string>;
  label?: string;
};

export async function fetchJson<T = any>(
  path: string,
  opts: FetchJsonOptions = {}
): Promise<{ data: T; headers: Headers }> {
  const { url } = getSupabaseEnv();
  const base = path.startsWith('http') ? path : `${url}${path.startsWith('/') ? '' : '/'}${path}`;
  const queryString = opts.query
    ? Object.entries(opts.query)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  const finalUrl = queryString ? `${base}${base.includes('?') ? '&' : '?'}${queryString}` : base;

  // fail fast if auth required but no token is present
  if (opts.requireAuth) {
    await getAccessTokenFromStorage();
  }
  const headers = {
    ...(await buildHeaders({ requireAuth: opts.requireAuth })),
    ...(opts.headers ?? {}),
  };
  const method = opts.method ?? 'GET';
  const methodNeedsJson = ['POST', 'PATCH', 'PUT'].includes(method.toUpperCase());
  if (methodNeedsJson) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
    headers['Accept'] = headers['Accept'] ?? 'application/json';
    if (!headers['Prefer']) {
      headers['Prefer'] = 'return=representation';
    }
  } else if (opts.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const controller = new AbortController();
  const timeout = opts.timeoutMs ?? 15_000;
  const timer = setTimeout(() => controller.abort(), timeout);
  const started = Date.now();

  let recordedError = false;
  const endpointLabel = opts.label ?? new URL(finalUrl).pathname;
  try {
    console.log(`[rest] ${method} ${endpointLabel} start`);
    const response = await fetch(finalUrl, {
      method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const elapsed = Date.now() - started;
    if (!response.ok) {
      const truncated = text.slice(0, 200);
      console.error(
        `[rest] ${method} ${endpointLabel} fail ${response.status} in ${elapsed}ms body=${truncated}`
      );
      await recordApiError({
        endpoint: endpointLabel,
        status: response.status,
        message: truncated || `HTTP ${response.status}`,
      });
      recordedError = true;
      throw new Error(`HTTP ${response.status}: ${truncated}`);
    }
    console.log(`[rest] ${method} ${endpointLabel} ok in ${elapsed}ms`);
    return { data: json as T, headers: response.headers };
  } catch (err: any) {
    if (err?.name !== 'AbortError' && !recordedError) {
      await recordApiError({
        endpoint: endpointLabel,
        status: err?.status ?? null,
        message: err?.message ?? String(err),
      });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchLockedPlayersToday(): Promise<Set<string>> {
  try {
    const { data } = await fetchJson<{ player_id: string }[]>('/rest/v1/locked_players_today', {
      requireAuth: true,
      query: { select: 'player_id' },
      timeoutMs: 10_000,
    });
    const set = new Set<string>();
    (data ?? []).forEach(row => {
      if (row?.player_id) set.add(row.player_id);
    });
    return set;
  } catch (err) {
    console.warn('[locks] failed to fetch locked players', err);
    throw err;
  }
}
