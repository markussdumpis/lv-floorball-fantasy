import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

export const DIAGNOSTICS_ENABLED = process.env.EXPO_PUBLIC_DIAGNOSTICS === 'true' || __DEV__;
export const DIAGNOSTICS_LOGGING = process.env.EXPO_PUBLIC_DIAGNOSTICS_LOGGING === 'true';

const ERROR_KEY = 'diagnostics:lastError';
const LAST_WRITE_KEY = 'diagnostics:lastCoreWrite';

export type StoredApiError = {
  endpoint: string;
  status: number | null;
  message: string;
  timestamp: string; // ISO string
};

export type StoredCoreWrite = {
  label: string;
  timestamp: string; // ISO string
};

const MAX_MESSAGE_LENGTH = 180;

function truncate(message: string) {
  if (!message) return '';
  if (message.length <= MAX_MESSAGE_LENGTH) return message;
  return `${message.slice(0, MAX_MESSAGE_LENGTH)}…`;
}

export async function recordApiError(error: {
  endpoint: string;
  status: number | null;
  message: string;
}) {
  try {
    const payload: StoredApiError = {
      endpoint: error.endpoint,
      status: error.status,
      message: truncate(error.message),
      timestamp: new Date().toISOString(),
    };
    await AsyncStorage.setItem(ERROR_KEY, JSON.stringify(payload));
  } catch (err) {
    if (__DEV__) {
      console.warn('[diag] failed to persist api error', err);
    }
  }
}

export async function getLastApiError(): Promise<StoredApiError | null> {
  try {
    const raw = await AsyncStorage.getItem(ERROR_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredApiError;
  } catch (err) {
    if (__DEV__) {
      console.warn('[diag] failed to read api error', err);
    }
    return null;
  }
}

export async function recordCoreWrite(label: string) {
  try {
    const payload: StoredCoreWrite = {
      label,
      timestamp: new Date().toISOString(),
    };
    await AsyncStorage.setItem(LAST_WRITE_KEY, JSON.stringify(payload));
  } catch (err) {
    if (__DEV__) {
      console.warn('[diag] failed to persist core write', err);
    }
  }
}

export async function getLastCoreWrite(): Promise<StoredCoreWrite | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_WRITE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredCoreWrite;
  } catch (err) {
    if (__DEV__) {
      console.warn('[diag] failed to read core write', err);
    }
    return null;
  }
}

export function diagLog(event: string, detail?: Record<string, any>) {
  if (!DIAGNOSTICS_LOGGING) return;
  const payload = detail ? JSON.stringify(sanitizeLogData(detail)) : '';
  const version = Constants.expoConfig?.version ?? 'dev';
  console.log(`[diag] ${event} v${version}${payload ? ' ' + payload : ''}`);
}

const REDACT_KEYS = ['token', 'jwt', 'authorization', 'access_token', 'refresh_token'];

export function sanitizeLogData<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map(item => sanitizeLogData(item)) as unknown as T;
  }
  const safe: Record<string, any> = {};
  for (const [key, val] of Object.entries(value as Record<string, any>)) {
    const normalized = key.toLowerCase();
    if (REDACT_KEYS.some(k => normalized.includes(k))) {
      safe[key] = '[REDACTED]';
    } else if (val && typeof val === 'object') {
      safe[key] = sanitizeLogData(val);
    } else {
      safe[key] = val;
    }
  }
  return safe as T;
}

export async function clearDiagnosticsStorage() {
  await AsyncStorage.multiRemove([ERROR_KEY, LAST_WRITE_KEY]);
}
