export type FetchWithTimeoutResponse<T = unknown> = {
  ok: boolean;
  status: number;
  json: T | null;
  text: string;
  headers: Headers;
};

export async function fetchWithTimeout<T = unknown>(
  url: string,
  init: RequestInit = {},
  ms = 15_000,
  label?: string
): Promise<FetchWithTimeoutResponse<T>> {
  const controller = new AbortController();
  const started = Date.now();
  const method = (init.method ?? 'GET').toString().toUpperCase();

  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<FetchWithTimeoutResponse<T>>((_, reject) => {
    timeoutId = setTimeout(() => {
      if (controller.abort) controller.abort();
      reject(new Error('TIMEOUT'));
    }, ms);
  });

  const fetchPromise = (async () => {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let json: T | null = null;
    try {
      json = text ? (JSON.parse(text) as T) : null;
    } catch (_) {
      json = null;
    }
    if (__DEV__ && label) {
      console.log(`${label} ${method} ${url} -> ${response.status} in ${Date.now() - started}ms`);
    }
    return { ok: response.ok, status: response.status, json, text, headers: response.headers };
  })();

  try {
    return await Promise.race([fetchPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}
