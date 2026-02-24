import { getEnv } from './env.js';
import { cleanText, loadHtml } from './html.js';
import { createSupabase } from './supa.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetch, type Headers as UndiciHeaders } from 'undici';

type CalendarRow = {
  date: Date;
  homeName: string;
  awayName: string;
  venue: string | null;
  protocolId: string | null;
  hasProtocolLink: boolean;
  scoreText: string | null;
  homeScore: number | null;
  awayScore: number | null;
  status: 'finished' | 'scheduled';
};

type ParsedMatch = {
  date: Date;
  homeName: string;
  awayName: string;
  venue: string | null;
  protocolId: string | null;
  resultText: string | null;
  status: 'finished' | 'scheduled';
  homeScore: number | null;
  awayScore: number | null;
};

type TeamRow = { id: string; code: string | null; name: string | null };

const LOG_PREFIX = '[ingest:matches]';
const DEFAULT_SPELU_VEIDS = '00';
const CONFLICT_KEY = 'season,date,home_team,away_team';
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DEBUG_INGEST = process.env.INGEST_DEBUG === '1';
const REQUEST_TIMEOUT_MS = 30_000;
const MONTH_ATTEMPT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000];
const INTER_MONTH_DELAY_MIN_MS = 300;
const INTER_MONTH_DELAY_MAX_MS = 800;
const MONTH_FETCH_URL = 'https://www.floorball.lv/ajax/ajax_chempionats_kalendars.php';
const MONTH_OPTIONS_URL = 'https://www.floorball.lv/ajax/ajax_chempionats_kalendars_meneshi.php';
const LFS_ORIGIN = 'https://www.floorball.lv';
type FailureClass = 'EMPTY_BODY' | 'HTML_BODY' | '403' | '429' | '5XX' | 'TIMEOUT' | 'DNS';

type LfsSession = {
  referer: string;
  userAgent: string;
  cookieJar: Map<string, string>;
};

type LfsResponse = {
  status: number;
  body: string;
  headers: Record<string, string>;
  url: string;
};

type AttemptFailure = {
  classification: FailureClass;
  status: number | null;
  contentType: string;
  contentLength: string;
  bodyPrefix: string;
};

function redactSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted = { ...headers };
  delete redacted.cookie;
  delete redacted.Cookie;
  delete redacted['set-cookie'];
  delete redacted['Set-Cookie'];
  return redacted;
}

function parseBoolean(value: string | undefined, defaultValue = false): boolean {
  if (!value) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function sanitizeBodyPrefix(rawBody: string): string {
  return rawBody
    .replace(/\s+/g, ' ')
    .replace(/(token|session|auth|bearer|apikey|api_key|password|passwd)\s*[:=]\s*['"]?[^'"&\s<]{6,}/gi, '$1=<redacted>')
    .replace(/(?:[?&](?:token|auth|session|apikey|api_key)=[^&\s]{4,})/gi, '<redacted-query>')
    .trim()
    .slice(0, 200);
}

function normalizeHeaders(headers: UndiciHeaders): Record<string, string> {
  return Object.fromEntries(Array.from(headers.entries()).map(([k, v]) => [k.toLowerCase(), v]));
}

function parseCookiePairs(cookieHeader: string): Array<[string, string]> {
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const idx = part.indexOf('=');
      if (idx < 1) return null;
      return [part.slice(0, idx).trim(), part.slice(idx + 1).trim()] as [string, string];
    })
    .filter((pair): pair is [string, string] => Boolean(pair));
}

function createLfsSession(env: ReturnType<typeof getEnv>, league: string): LfsSession {
  const cookieJar = new Map<string, string>();
  for (const [name, value] of parseCookiePairs(env.cookie ?? '')) {
    cookieJar.set(name, value);
  }

  return {
    referer: `${LFS_ORIGIN}/lv/2025/chempionats/${league}/kalendars`,
    userAgent: env.userAgent?.trim() || BROWSER_USER_AGENT,
    cookieJar,
  };
}

function extractSetCookieHeaders(headers: UndiciHeaders): string[] {
  const headerBag = headers as UndiciHeaders & { getSetCookie?: () => string[] };
  if (typeof headerBag.getSetCookie === 'function') {
    return headerBag.getSetCookie();
  }
  const raw = headers.get('set-cookie');
  return raw ? [raw] : [];
}

function updateCookieJarFromResponse(session: LfsSession, responseHeaders: UndiciHeaders): void {
  for (const setCookie of extractSetCookieHeaders(responseHeaders)) {
    const firstPart = setCookie.split(';', 1)[0]?.trim();
    if (!firstPart) continue;
    const eqIndex = firstPart.indexOf('=');
    if (eqIndex < 1) continue;
    const cookieName = firstPart.slice(0, eqIndex).trim();
    const cookieValue = firstPart.slice(eqIndex + 1).trim();
    if (!cookieName) continue;
    session.cookieJar.set(cookieName, cookieValue);
  }
}

function buildCookieHeader(session: LfsSession): string {
  return Array.from(session.cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function buildLfsHeaders(
  session: LfsSession,
  overrides: Record<string, string> = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': session.userAgent,
    Accept: 'application/json,text/plain,*/*',
    'Accept-Language': 'lv,en;q=0.9',
    Referer: session.referer,
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    ...overrides,
  };

  const cookieHeader = buildCookieHeader(session);
  if (cookieHeader) {
    headers.cookie = cookieHeader;
  }
  return headers;
}

async function lfsRequest(
  session: LfsSession,
  url: string,
  options: {
    method: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<LfsResponse> {
  const response = await fetch(url, {
    method: options.method,
    headers: buildLfsHeaders(session, options.headers),
    body: options.body,
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  updateCookieJarFromResponse(session, response.headers);
  const body = await response.text();
  return {
    status: response.status,
    body,
    headers: normalizeHeaders(response.headers),
    url: response.url,
  };
}

async function warmUpLfsSession(session: LfsSession): Promise<void> {
  const response = await lfsRequest(session, session.referer, { method: 'GET' });
  console.log(`${LOG_PREFIX} Warm-up complete`, {
    status: response.status,
    url: response.url,
    has_cookie: buildCookieHeader(session).length > 0,
  });
}

function classifyFailure(input: {
  status: number | null;
  bodyText: string;
  contentType: string;
  error?: unknown;
}): FailureClass {
  const status = input.status;
  if (status === 403) return '403';
  if (status === 429) return '429';
  if (status !== null && status >= 500) return '5XX';

  if (input.error instanceof Error) {
    const code = ((input.error as Error & { code?: string }).code ?? '').toUpperCase();
    if (code.includes('TIMEOUT') || code === 'ABORT_ERR') return 'TIMEOUT';
    if (code.includes('ENOTFOUND') || code.includes('EAI_AGAIN') || code.includes('DNS')) return 'DNS';
    const message = input.error.message.toLowerCase();
    if (message.includes('timeout')) return 'TIMEOUT';
    if (message.includes('enotfound') || message.includes('dns')) return 'DNS';
  }

  if (!input.bodyText.trim()) return 'EMPTY_BODY';
  // HTML_BODY usually means upstream sent a rendered page (maintenance/anti-bot) instead of JSON.
  if (input.contentType.toLowerCase().includes('text/html') || input.bodyText.trim().startsWith('<')) return 'HTML_BODY';
  return 'HTML_BODY';
}

function logAttemptFailure(params: {
  monthFilter: string;
  attempt: number;
  url: string;
  failure: AttemptFailure;
}): void {
  console.warn(`${LOG_PREFIX} MONTH_ATTEMPT_FAILED`, {
    month: params.monthFilter,
    attempt: params.attempt,
    url: params.url,
    status: params.failure.status,
    content_type: params.failure.contentType,
    content_length: params.failure.contentLength,
    class: params.failure.classification,
    body_prefix: params.failure.bodyPrefix,
  });
}

function parseRetryAfterMs(value: string | undefined): number | null {
  if (!value) return null;
  const asSeconds = Number.parseInt(value, 10);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return asSeconds * 1_000;
  }

  const asDate = Date.parse(value);
  if (Number.isNaN(asDate)) return null;
  const deltaMs = asDate - Date.now();
  return deltaMs > 0 ? deltaMs : 0;
}

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function normalizeCode(value: string | null | undefined): string {
  return normalize(value).replace(/\s+/g, '') || 'unknown';
}

function parseArgs(): { season: string; league: string } {
  const args = process.argv.slice(2);
  const defaults = { season: '2025-26', league: 'vv' };

  return args.reduce(
    (acc, arg) => {
      const [key, value] = arg.replace(/^--/, '').split('=');
      if (key === 'season' && value) acc.season = value;
      if (key === 'league' && value) acc.league = value;
      return acc;
    },
    { ...defaults },
  );
}

function parseDateTime(rawDate: string | null, rawTime: string | null, seasonYear: string): Date | null {
  const dateMatch = (rawDate ?? '').match(/(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/);
  if (!dateMatch) return null;
  const day = Number.parseInt(dateMatch[1], 10);
  const month = Number.parseInt(dateMatch[2], 10);
  const parsedYear = dateMatch[3] ? Number.parseInt(dateMatch[3], 10) : null;

  const timeMatch = (rawTime ?? rawDate ?? '').match(/(\d{1,2}):(\d{2})/);
  const hour = timeMatch ? Number.parseInt(timeMatch[1], 10) : 0;
  const minute = timeMatch ? Number.parseInt(timeMatch[2], 10) : 0;

  const seasonStartYear = Number.parseInt(seasonYear.split('-')[0], 10);
  const inferredYear =
    parsedYear && parsedYear < 100 ? 2000 + parsedYear : parsedYear ?? (!Number.isNaN(seasonStartYear) ? seasonStartYear + (month <= 7 ? 1 : 0) : NaN);

  const year = inferredYear;
  if (!Number.isFinite(year)) return null;

  return new Date(Date.UTC(year, month - 1, day, hour, minute));
}

function parseScore(raw: string | null): { home: number; away: number } | null {
  if (!raw) return null;
  const match = raw.replace(/\s+/g, '').match(/(\d+)\s*[:\-]\s*(\d+)/);
  if (!match) return null;
  const home = Number.parseInt(match[1], 10);
  const away = Number.parseInt(match[2], 10);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return { home, away };
}

function stripHtml(value: string | null | undefined): string {
  const html = value ?? '';
  const $ = loadHtml(html);
  return cleanText($.text());
}

function extractProtocolId(href: string | null): string | null {
  if (!href) return null;
  const match = href.match(/(?:^|\/)proto\/([^\/?#'"\s]+)/);
  return match?.[1] ?? null;
}

function extractProtocolIdFromText(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/(?:^|\/)proto\/([^\/?#'"\s]+)/);
  return match?.[1] ?? null;
}

function parseAjaxRows(aaData: unknown[], seasonYear: string): { rows: CalendarRow[]; noProtocolCount: number } {
  const rows: CalendarRow[] = [];
  let noProtocolCount = 0;

  aaData.forEach((entry) => {
    if (!Array.isArray(entry) || entry.length < 6) return;
    const cells = entry as Array<string>;
    const [dateCell, timeCell, homeCell, resultCell, awayCell, venueCell] = cells;

    const dateText = stripHtml(dateCell);
    const timeText = stripHtml(timeCell);
    const homeText = stripHtml(homeCell);
    const awayText = stripHtml(awayCell);
    const venueText = stripHtml(venueCell);

    const parsedDate = parseDateTime(dateText, timeText, seasonYear);
    if (!parsedDate) {
      console.warn(`${LOG_PREFIX} Skipping row with unparseable date/time`, entry);
      return;
    }

    const rowHtml = cells.join(' ');
    const protocolId = extractProtocolId(rowHtml) ?? extractProtocolIdFromText(rowHtml);
    if (!protocolId) {
      noProtocolCount += 1;
      if (parsedDate < new Date()) {
        console.log('[matches] past match missing proto', {
          date: parsedDate.toISOString(),
          home: homeText,
          away: awayText,
        });
      }
    }
    const resultText = stripHtml(resultCell);
    const scoreMatch = resultText.match(/(\d+)\s*:\s*(\d+)/);
    const homeScore = scoreMatch ? Number.parseInt(scoreMatch[1], 10) : null;
    const awayScore = scoreMatch ? Number.parseInt(scoreMatch[2], 10) : null;
    const status: 'finished' | 'scheduled' = scoreMatch || protocolId ? 'finished' : 'scheduled';

    rows.push({
      date: parsedDate,
      homeName: homeText,
      awayName: awayText,
      venue: venueText || null,
      protocolId,
      hasProtocolLink: Boolean(protocolId),
      scoreText: resultText || null,
      homeScore,
      awayScore,
      status,
    });
  });

  return { rows, noProtocolCount };
}

function mapTeamId(rawName: string, teams: TeamRow[]): { id: string; code: string } | null {
  const normalized = normalize(rawName);
  const byCode = teams.find((team) => normalize(team.code) === normalized);
  if (byCode) {
    return { id: byCode.id, code: byCode.code ? normalizeCode(byCode.code) : normalized };
  }
  const byName = teams.find((team) => normalize(team.name) === normalized);
  if (byName) {
    return { id: byName.id, code: byName.code ? normalizeCode(byName.code) : normalized };
  }
  return null;
}

async function loadTeams(client: SupabaseClient): Promise<TeamRow[]> {
  const { data, error } = await client.from('teams').select('id, code, name');
  if (error) {
    throw error;
  }
  return data ?? [];
}

function buildParsedMatches(rows: CalendarRow[]): ParsedMatch[] {
  return rows.map((row) => {
    return {
      date: row.date,
      homeName: row.homeName,
      awayName: row.awayName,
      venue: row.venue,
      protocolId: row.protocolId,
      resultText: row.scoreText ?? null,
      status: row.status,
      homeScore: row.homeScore,
      awayScore: row.awayScore,
    };
  });
}

async function upsertMatches(
  client: SupabaseClient,
  matches: ParsedMatch[],
  season: string,
  league: string,
  seasonCode: string,
  teams: TeamRow[],
): Promise<{
  upserted: number;
  inserted: number;
  updated: number;
  skipped: number;
  scheduledProcessed: number;
}> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const unmappedTeams: Set<string> = new Set();
  const rowsToUpsert: Array<Record<string, unknown>> = [];
  let scheduledProcessed = 0;

  const existingFixtureKeys = new Set<string>();
  const { data: existingFixtures, error: existingFixturesError } = await client
    .from('matches')
    .select('season, date, home_team, away_team')
    .eq('season', season);
  if (existingFixturesError) {
    console.warn(`${LOG_PREFIX} Failed to load existing fixtures for season ${season}; inserted/updated counts may be off`, {
      error: existingFixturesError,
    });
  } else {
    for (const row of existingFixtures ?? []) {
      const key = `${row.season}|${row.date}|${row.home_team}|${row.away_team}`;
      existingFixtureKeys.add(key);
    }
  }

  for (const match of matches) {
    const home = mapTeamId(match.homeName, teams);
    const away = mapTeamId(match.awayName, teams);

    if (!home || !away) {
      skipped += 1;
      if (!home) unmappedTeams.add(match.homeName);
      if (!away) unmappedTeams.add(match.awayName);
      console.warn(`${LOG_PREFIX} UNMAPPED_TEAM`, { home: match.homeName, away: match.awayName });
      return;
    }

    if (match.status === 'scheduled') {
      scheduledProcessed += 1;
    }

    const fixtureKey = `${season}|${match.date.toISOString()}|${home.id}|${away.id}`;
    if (existingFixtureKeys.has(fixtureKey)) {
      updated += 1;
    } else {
      inserted += 1;
    }
    existingFixtureKeys.add(fixtureKey);

    const fallbackExternalId = `${match.date.toISOString()}|${normalize(match.homeName)}|${normalize(match.awayName)}|${seasonCode}`;
    const externalId = match.protocolId ?? fallbackExternalId;

    rowsToUpsert.push({
      external_id: externalId,
      date: match.date.toISOString(),
      season,
      home_team: home.id,
      away_team: away.id,
      venue: match.venue,
      status: match.status,
      home_score: match.homeScore,
      away_score: match.awayScore,
    });
  }

  console.log(`${LOG_PREFIX} Parsed ${matches.length} matches; upserting ${rowsToUpsert.length}; skipped ${skipped}`);
  if (unmappedTeams.size > 0) {
    console.warn(`${LOG_PREFIX} Unmapped teams: ${Array.from(unmappedTeams).join(', ')}`);
  }

  if (!rowsToUpsert.length) {
    return { upserted: 0, inserted, updated, skipped, scheduledProcessed };
  }

  console.log(`${LOG_PREFIX} Upsert on_conflict key`, { conflictKey: CONFLICT_KEY });

  const { data, error, count } = await client
    .from('matches')
    .upsert(rowsToUpsert, { onConflict: CONFLICT_KEY, ignoreDuplicates: false })
    .select('id', { count: 'exact' });

  if (error) {
    throw error;
  }

  const upsertedCount = data?.length ?? count ?? rowsToUpsert.length;
  console.log(`${LOG_PREFIX} Upserted rows`, {
    inserted_or_updated: upsertedCount,
    attempted: rowsToUpsert.length,
    inserted_estimate: inserted,
    updated_estimate: updated,
  });
  return {
    upserted: upsertedCount,
    inserted,
    updated,
    skipped,
    scheduledProcessed,
  };
}

async function fetchCalendarPages(
  session: LfsSession,
  ajaxUrl: string,
  league: string,
  seasonCode: string,
  monthFilter: string,
  speluVeids: string,
): Promise<{ aaData: unknown[]; totalRecords: number }> {
  const maxRetries = 5;

  const params = new URLSearchParams({
    filtrs_menesis: monthFilter,
    filtrs_grupa: league,
    filtrs_sezona: seasonCode,
    filtrs_spelu_veids: speluVeids,
  });
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    Origin: LFS_ORIGIN,
  };

  if (DEBUG_INGEST) {
    const safeHeaders = redactSensitiveHeaders(buildLfsHeaders(session, requestHeaders));
    console.log(`${LOG_PREFIX} AJAX request debug`, {
      ajaxUrl,
      monthFilter,
      requestBody: Object.fromEntries(params.entries()),
      headers: safeHeaders,
    });
  }

  let payload: Record<string, unknown> | null = null;
  let lastFailure: AttemptFailure | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await lfsRequest(session, ajaxUrl, {
        method: 'POST',
        headers: requestHeaders,
        body: params.toString(),
      });
      const contentType = response.headers['content-type'] ?? 'unknown';
      const contentLength = response.headers['content-length'] ?? 'unknown';
      const trimmed = response.body.trim();
      const isJsonLike = trimmed.startsWith('{') || trimmed.startsWith('[');
      const isJsonContent = contentType.toLowerCase().includes('application/json');
      const shouldParseJson = response.status < 400 && isJsonLike && (isJsonContent || trimmed.length > 0);

      if (shouldParseJson) {
        try {
          payload = JSON.parse(trimmed) as Record<string, unknown>;
          break;
        } catch (err) {
          const classification = classifyFailure({
            status: response.status,
            bodyText: response.body,
            contentType,
          });
          lastFailure = {
            classification,
            status: response.status,
            contentType,
            contentLength,
            bodyPrefix: '',
          };
          logAttemptFailure({
            monthFilter,
            attempt,
            url: response.url || ajaxUrl,
            failure: lastFailure,
          });
          if (DEBUG_INGEST) {
            console.warn(`${LOG_PREFIX} MONTH_JSON_PARSE_FAILED`, {
              month: monthFilter,
              attempt,
              status: response.status,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } else {
        const classification = classifyFailure({
          status: response.status,
          bodyText: response.body,
          contentType,
        });
        lastFailure = {
          classification,
          status: response.status,
          contentType,
          contentLength,
          bodyPrefix: isJsonLike ? '' : sanitizeBodyPrefix(response.body),
        };
        logAttemptFailure({
          monthFilter,
          attempt,
          url: response.url || ajaxUrl,
          failure: lastFailure,
        });
      }

      if (attempt >= maxRetries) {
        break;
      }

      const retryAfterMs = response.status === 429 ? parseRetryAfterMs(response.headers['retry-after']) : null;
      const jitter = randomBetween(0, 300);
      const backoffMs = MONTH_ATTEMPT_BACKOFF_MS[Math.min(attempt - 1, MONTH_ATTEMPT_BACKOFF_MS.length - 1)];
      await sleep((retryAfterMs ?? backoffMs) + jitter);
    } catch (error) {
      const classification = classifyFailure({
        status: null,
        bodyText: '',
        contentType: '',
        error,
      });
      lastFailure = {
        classification,
        status: null,
        contentType: 'unknown',
        contentLength: 'unknown',
        bodyPrefix: '',
      };
      logAttemptFailure({
        monthFilter,
        attempt,
        url: ajaxUrl,
        failure: lastFailure,
      });
      if (attempt >= maxRetries) {
        break;
      }
      const jitter = randomBetween(0, 300);
      const backoffMs = MONTH_ATTEMPT_BACKOFF_MS[Math.min(attempt - 1, MONTH_ATTEMPT_BACKOFF_MS.length - 1)];
      await sleep(backoffMs + jitter);
    }
  }

  if (!payload) {
    throw new Error(
      `Failed to fetch month ${monthFilter}: ${lastFailure?.classification ?? 'EMPTY_BODY'} after ${maxRetries} attempts`,
    );
  }

  const aaData = Array.isArray(payload?.aaData) ? payload.aaData : [];
  const totalRecords = Number(payload?.iTotalRecords ?? payload?.iTotalDisplayRecords ?? aaData.length ?? 0);
  console.log(`${LOG_PREFIX} Month ${monthFilter} aaData length`, { rows: aaData.length, totalRecords });

  return { aaData, totalRecords };
}

async function fetchMonthOptions(params: {
  session: LfsSession;
  seasonCode: string;
  league: string;
  speluVeids: string;
}): Promise<string[]> {
  const { session, seasonCode, league, speluVeids } = params;
  const url = MONTH_OPTIONS_URL;
  const bodyParams = new URLSearchParams({
    sezona: seasonCode,
    grupa: league,
    filtrs_spelu_veids: speluVeids,
  });

  console.log(`${LOG_PREFIX} Fetching month options`, { url, seasonCode, league, speluVeids });
  const response = await lfsRequest(session, url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: LFS_ORIGIN,
    },
    body: bodyParams.toString(),
  });
  if (response.status >= 400) {
    throw new Error(`Failed to fetch month options: HTTP ${response.status}`);
  }

  const $ = loadHtml(response.body);
  const values: string[] = [];
  $('option').each((_, el) => {
    const val = ($(el).attr('value') ?? '').trim();
    if (!val || val === '00') return;
    values.push(val);
  });

  console.log(`${LOG_PREFIX} Month options found (${values.length}): ${values.join(', ')}`);
  return values;
}

async function main(): Promise<void | { inserted: number; skipped: boolean }> {
  console.log(`${LOG_PREFIX} version=0e71aab conflictKey=${CONFLICT_KEY}`);

  const { season, league } = parseArgs();
  const env = getEnv();
  const failOnAllMonthsFailed = parseBoolean(process.env.FAIL_ON_ALL_MONTHS_FAILED, false);
  const hasCookie = Boolean(env.cookie?.trim());
  console.log(`${LOG_PREFIX} Request auth headers`, { has_cookie: hasCookie, fail_on_all_months_failed: failOnAllMonthsFailed });
  if (process.env.CI && !hasCookie) {
    console.warn(`${LOG_PREFIX} Missing LFS_COOKIE in CI; continuing with warm-up cookies only`);
  }
  const supa = createSupabase(env);
  const session = createLfsSession(env, league);
  const ajaxUrl = MONTH_FETCH_URL;
  const seasonCode = '34';
  const speluVeids = DEFAULT_SPELU_VEIDS;
  await warmUpLfsSession(session);

  const monthOptions = await fetchMonthOptions({ session, seasonCode, league, speluVeids });
  const monthsToFetch = monthOptions.length ? monthOptions : ['00'];
  console.log(`${LOG_PREFIX} Months to fetch (${monthsToFetch.length}): ${monthsToFetch.join(', ')}`);

  const allCalendarRows: CalendarRow[] = [];
  let combinedAaDataCount = 0;
  let totalNoProtocolCount = 0;
  const successfulMonths: string[] = [];
  const failedMonths: string[] = [];
  const failedMonthErrors: unknown[] = [];

  for (const monthFilter of monthsToFetch) {
    console.log(`${LOG_PREFIX} Fetching calendar AJAX`, { ajaxUrl, league, seasonCode, monthFilter });
    let result: { aaData: unknown[]; totalRecords: number } | null = null;
    try {
      result = await fetchCalendarPages(session, ajaxUrl, league, seasonCode, monthFilter, speluVeids);
      successfulMonths.push(monthFilter);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      failedMonths.push(monthFilter);
      failedMonthErrors.push(err);
      if (monthFilter === 'all') {
        console.warn(`${LOG_PREFIX} Month fetch failed for 'all' (non-fatal); continuing`, {
          monthFilter,
          league,
          seasonCode,
          speluVeids,
          requestBody: {
            filtrs_menesis: monthFilter,
            filtrs_grupa: league,
            filtrs_sezona: seasonCode,
            filtrs_spelu_veids: speluVeids,
          },
          error: errorMessage,
        });
        continue;
      }
      console.warn(`${LOG_PREFIX} Month fetch failed, skipping`, {
        monthFilter,
        league,
        seasonCode,
        speluVeids,
        requestBody: {
          filtrs_menesis: monthFilter,
          filtrs_grupa: league,
          filtrs_sezona: seasonCode,
          filtrs_spelu_veids: speluVeids,
        },
        error: errorMessage,
      });
      continue;
    }
    finally {
      const monthDelayMs = randomBetween(INTER_MONTH_DELAY_MIN_MS, INTER_MONTH_DELAY_MAX_MS);
      await sleep(monthDelayMs);
    }

    combinedAaDataCount += result.aaData.length;
    console.log(`${LOG_PREFIX} Month ${monthFilter} totals: totalRecords=${result.totalRecords}, totalRowsFetched=${result.aaData.length}`);

    const { rows: calendarRows, noProtocolCount } = parseAjaxRows(result.aaData, season);
    console.log(`${LOG_PREFIX} Month ${monthFilter} parsed rows=${calendarRows.length}, noProtocol=${noProtocolCount}`);
    totalNoProtocolCount += noProtocolCount;
    allCalendarRows.push(...calendarRows);
  }

  console.log(`${LOG_PREFIX} Total raw rows fetched across months: ${combinedAaDataCount}`);
  console.log(`${LOG_PREFIX} Total fetched from LFS`, { rows: combinedAaDataCount });
  console.log(`${LOG_PREFIX} Summary per month`, {
    successful_months: successfulMonths,
    failed_months: failedMonths,
    successful_count: successfulMonths.length,
    failed_count: failedMonths.length,
  });

  if (successfulMonths.length === 0) {
    const summary = {
      failed_months: failedMonths,
      failed_count: failedMonths.length,
      successful_count: successfulMonths.length,
      league,
      seasonCode,
      speluVeids,
      errors: failedMonthErrors.map((error) => (error instanceof Error ? error.message : String(error))),
    };
    console.error(`${LOG_PREFIX} ALL_MONTHS_FAILED`, summary);
    if (!failOnAllMonthsFailed) {
      console.warn(`${LOG_PREFIX} Soft-fail active (FAIL_ON_ALL_MONTHS_FAILED=false); exiting without hard failure.`);
      return { inserted: 0, skipped: true };
    }
    console.error(`${LOG_PREFIX} FATAL: 0 rows fetched from LFS; likely blocked. Failing job.`);
    process.exitCode = 1;
    throw new Error('All months failed due to upstream instability');
  }

  if (combinedAaDataCount === 0 && failedMonths.length > 0) {
    const summary = {
      successful_months: successfulMonths,
      failed_months: failedMonths,
      successful_count: successfulMonths.length,
      failed_count: failedMonths.length,
      league,
      seasonCode,
      speluVeids,
      total_rows: combinedAaDataCount,
    };
    console.error(`${LOG_PREFIX} Upstream instability detected with zero fetched rows`, summary);
    console.error(`${LOG_PREFIX} FATAL: 0 rows fetched from LFS; likely blocked. Failing job.`);
    process.exitCode = 1;
    throw new Error('Zero rows fetched with upstream month failures');
  }

  if (combinedAaDataCount === 0 && !allCalendarRows.length && failedMonths.length === 0) {
    console.error(`${LOG_PREFIX} FATAL: 0 rows fetched from LFS; likely blocked. Failing job.`);
    process.exitCode = 1;
    throw new Error('Zero rows fetched from LFS');
  }

  if (!allCalendarRows.length) {
    console.error(`${LOG_PREFIX} Upstream fetch failed: no calendar rows parsed across all months`);
    process.exit(1);
  }

  const dedupedMap = new Map<string, CalendarRow>();
  allCalendarRows.forEach((row) => {
    const key = row.protocolId
      ? `proto:${row.protocolId}`
      : `fallback:${row.date.toISOString()}|${normalize(row.homeName)}|${normalize(row.awayName)}|${seasonCode}`;
    if (!dedupedMap.has(key)) {
      dedupedMap.set(key, row);
    }
  });
  const calendarRows = Array.from(dedupedMap.values());
  console.log(`${LOG_PREFIX} Unique calendar rows after merge: ${calendarRows.length}`);

  const parsedMatches = buildParsedMatches(calendarRows);
  console.log(`${LOG_PREFIX} Parsed rows`, { parsed: parsedMatches.length, noProtocolCount: totalNoProtocolCount });
  console.log(`${LOG_PREFIX} Rows without protocol link: ${totalNoProtocolCount}`);
  console.log(`${LOG_PREFIX} Matches fetched`, { total: parsedMatches.length });
  console.log(`${LOG_PREFIX} Fetch summary`, {
    successful_months: successfulMonths,
    failed_months: failedMonths,
    total_rows: parsedMatches.length,
  });

  const teams = await loadTeams(supa.client);
  console.log(`${LOG_PREFIX} Loaded ${teams.length} teams for mapping`);

  const {
    upserted,
    inserted,
    updated,
    skipped,
    scheduledProcessed,
  } = await upsertMatches(
    supa.client,
    parsedMatches,
    season,
    league,
    seasonCode,
    teams,
  );

  console.log(`${LOG_PREFIX} Matches written`, { written: upserted });

  const { count: pastScheduledCount, error: pastScheduledError } = await supa.client
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'scheduled')
    .eq('season', '2025-26')
    .lt('date', new Date().toISOString());
  if (pastScheduledError) {
    console.warn(`${LOG_PREFIX} Failed to count past scheduled matches`, pastScheduledError);
  } else {
    console.log(`${LOG_PREFIX} Past scheduled matches after ingest`, { count: pastScheduledCount ?? 0 });
  }

  const finishedCount = parsedMatches.filter((m) => m.status === 'finished').length;
  const scheduledCount = parsedMatches.filter((m) => m.status === 'scheduled').length;
  const withProtocolCount = parsedMatches.filter((m) => Boolean(m.protocolId)).length;
  const withoutProtocolCount = parsedMatches.length - withProtocolCount;

  console.log(
    `${LOG_PREFIX} Summary: total_raw_rows=${combinedAaDataCount}, unique_rows=${calendarRows.length}, parsed=${parsedMatches.length}, upserted=${upserted}, inserted_estimate=${inserted}, updated_estimate=${updated}, skipped=${skipped}, finished=${finishedCount}, scheduled=${scheduledCount}, protocolLinks=${withProtocolCount}, withoutProtocol=${withoutProtocolCount}, scheduled_processed=${scheduledProcessed}`,
  );

  const examples = parsedMatches.slice(0, 3).map((m) => {
    const dateIso = m.date.toISOString();
    const protoOrFallback =
      m.protocolId ??
      `${m.date.toISOString()}|${normalize(m.homeName)}|${normalize(m.awayName)}|${seasonCode}`;
    return {
      date: dateIso,
      home: m.homeName,
      away: m.awayName,
      result: m.resultText ?? '',
      protocol: protoOrFallback,
    };
  });
  console.log(`${LOG_PREFIX} Example parsed rows:`, examples);
}

main().catch((error) => {
  console.error(`${LOG_PREFIX} Failed`, error);
  process.exit(1);
});
