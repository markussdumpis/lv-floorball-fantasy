import { setTimeout as delay } from 'node:timers/promises';
import { Headers, RequestInit, fetch } from 'undici';

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
const MIN_REQUEST_GAP_MS = 1_000;
const DEFAULT_MAX_ATTEMPTS = 3;

let lastRequestTimestamp = 0;

async function enforceRequestGap(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTimestamp;
  if (elapsed < MIN_REQUEST_GAP_MS) {
    await delay(MIN_REQUEST_GAP_MS - elapsed);
  }
  lastRequestTimestamp = Date.now();
}

export interface FetchWithRetryOptions extends RequestInit {
  maxAttempts?: number;
  backoffMs?: number;
}

export interface FetchWithRetryResult {
  body: string;
  status: number;
  headers: Headers;
}

export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<FetchWithRetryResult> {
  const { maxAttempts = DEFAULT_MAX_ATTEMPTS, backoffMs = 750, ...requestOptions } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await enforceRequestGap();

      const headers = new Headers(requestOptions.headers ?? {});
      if (!headers.has('user-agent')) {
        headers.set('user-agent', DEFAULT_USER_AGENT);
      }
      if (!headers.has('accept')) {
        headers.set('accept', 'text/html,application/xhtml+xml');
      }
      if (!headers.has('accept-language')) {
        headers.set('accept-language', 'lv,en;q=0.9');
      }

      const response = await fetch(url, {
        ...requestOptions,
        headers,
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status} ${response.statusText}`);
      }

      const body = await response.text();
      return {
        body,
        status: response.status,
        headers: new Headers(response.headers),
      };
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        break;
      }

      const waitTime = backoffMs * attempt;
      await delay(waitTime);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Request failed after maximum retries');
}

export async function fetchJsonWithRetry<T = unknown>(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<T> {
  const existingHeaders: Record<string, string> =
    options.headers instanceof Headers
      ? Object.fromEntries(options.headers.entries())
      : Array.isArray(options.headers)
      ? Object.fromEntries(options.headers)
      : { ...(options.headers as Record<string, string> | undefined) };

  const { body: responseText } = await fetchWithRetry(url, {
    ...options,
    headers: {
      accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
      ...existingHeaders,
    },
  });

  try {
    return JSON.parse(responseText) as T;
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${url}: ${(error as Error).message}`);
  }
}
