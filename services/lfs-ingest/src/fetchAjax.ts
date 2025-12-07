import { Headers, type HeadersInit } from 'undici';

import { fetchWithRetry, type FetchWithRetryOptions } from './http.js';

export interface AjaxResponse {
  raw: string;
  data: unknown;
}

export interface FetchAjaxRequest extends FetchWithRetryOptions {
  url: string;
  formBody: string;
  referer: string;
  userAgent: string;
  cookie: string;
  label?: string;
}

function headersInitToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...(headers as Record<string, string>) };
}

export async function fetchAjax(request: FetchAjaxRequest): Promise<AjaxResponse> {
  const {
    url,
    formBody,
    referer,
    userAgent,
    cookie,
    label = 'Ajax',
    headers: extraHeaders,
    ...requestOptions
  } = request;
  const trimmedReferer = referer.trim();
  if (!trimmedReferer) {
    throw new Error('fetchAjax requires a non-empty referer');
  }
  const trimmedUserAgent = userAgent.trim();
  const trimmedCookie = cookie.trim();
  if (!trimmedUserAgent) {
    throw new Error('fetchAjax requires a non-empty user agent');
  }
  if (!trimmedCookie) {
    throw new Error('fetchAjax requires a non-empty cookie');
  }

  // Use the captured curl headers (.env) so the AJAX request matches the working browser call.
  const headers = {
    accept: 'application/json, text/javascript, */*; q=0.01',
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'x-requested-with': 'XMLHttpRequest',
    origin: 'https://www.floorball.lv',
    referer: trimmedReferer,
    'user-agent': trimmedUserAgent,
    cookie: trimmedCookie,
    ...headersInitToRecord(extraHeaders),
  };

  console.log(`[debug] ${label} headers preview:`, {
    accept: headers.accept,
    origin: headers.origin,
    referer: headers.referer,
    hasCookie: !!headers.cookie,
    userAgentLength: headers['user-agent']?.length,
  });

  const { body: raw, status, headers: responseHeaders } = await fetchWithRetry(url, {
    ...requestOptions,
    method: 'POST',
    headers,
    body: formBody,
  });

  const contentType = responseHeaders.get('content-type') ?? 'unknown';
  const bodyPreview = raw.slice(0, 120);
  console.debug(
    `[ajax] POST ${url} status=${status} content-type=${contentType} body[0:120]=${bodyPreview}`,
  );

  let data: unknown = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    // Fall back to raw string when payload is not JSON.
  }

  return { raw, data };
}
