import { getEnv } from './env.js';
import { fetchWithRetry } from './http.js';
import { cleanText, loadHtml } from './html.js';
import { createSupabase } from './supa.js';
import type { SupabaseClient } from '@supabase/supabase-js';

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
const IS_CI = process.env.CI === 'true';

function redactSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted = { ...headers };
  delete redacted.cookie;
  delete redacted.Cookie;
  delete redacted['set-cookie'];
  delete redacted['Set-Cookie'];
  return redacted;
}

function logUpstreamResponseDebug(params: {
  status: number;
  contentType: string;
  contentLength: string;
  bodyText: string;
  monthFilter: string;
  league: string;
  seasonCode: string;
  attempt: number;
}): void {
  const { bodyText, ...meta } = params;
  console.warn(`${LOG_PREFIX} Upstream response debug`, {
    ...meta,
    bodyPreview: bodyText.slice(0, 200),
  });
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
  env: ReturnType<typeof getEnv>,
  ajaxUrl: string,
  league: string,
  seasonCode: string,
  monthFilter: string,
  speluVeids: string,
): Promise<{ aaData: unknown[]; totalRecords: number }> {
  const maxRetries = 5;
  const retryBackoffMs = [300, 700, 1500, 3000, 5000];

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Preflight to obtain PHPSESSID like a browser
  const preflightUrl = `https://www.floorball.lv/lv/2025/chempionats/${league}/kalendars`;
  const preflight = await fetchWithRetry(preflightUrl, {
    method: 'GET',
    headers: {
      'user-agent': env.userAgent,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  const setCookie = preflight.headers.get('set-cookie') ?? '';
  const cookieHeader = [env.cookie, setCookie].filter(Boolean).join('; ');

  const params = new URLSearchParams({
    filtrs_menesis: monthFilter,
    filtrs_grupa: league,
    filtrs_sezona: seasonCode,
    filtrs_spelu_veids: speluVeids,
  });
  const requestHeaders: Record<string, string> = {
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    Referer: 'https://www.floorball.lv/',
    Origin: 'https://www.floorball.lv',
    'User-Agent': env.userAgent || BROWSER_USER_AGENT,
    'Accept-Language': 'en-US,en;q=0.9',
    cookie: cookieHeader,
  };

  if (DEBUG_INGEST) {
    const safeHeaders = redactSensitiveHeaders(requestHeaders);
    console.log(`${LOG_PREFIX} AJAX request debug`, {
      ajaxUrl,
      monthFilter,
      requestBody: Object.fromEntries(params.entries()),
      headers: safeHeaders,
    });
  }

  let payload: any;
  let lastFailureReason = 'unknown';
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const { body, status, headers } = await fetchWithRetry(ajaxUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: params.toString(),
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
      cache: 'no-store',
    });
    const contentType = headers.get('content-type') ?? 'unknown';
    const contentLength = headers.get('content-length') ?? 'unknown';
    const bodyText = body?.toString() ?? '';
    const trimmed = bodyText.trim();
    const attemptInfo = {
      attempt,
      status,
      contentType,
      contentLength,
      bodyLength: bodyText.length,
      monthFilter,
    };
    if (DEBUG_INGEST) {
      console.log(`${LOG_PREFIX} Response attempt`, attemptInfo);
    }

    if (!bodyText.length) {
      lastFailureReason = 'empty-body';
      logUpstreamResponseDebug({
        status,
        contentType,
        contentLength,
        bodyText,
        monthFilter,
        league,
        seasonCode,
        attempt,
      });
    }

    const isHtml = contentType.toLowerCase().includes('text/html');
    if (isHtml) {
      lastFailureReason = 'html-response';
      logUpstreamResponseDebug({
        status,
        contentType,
        contentLength,
        bodyText: trimmed,
        monthFilter,
        league,
        seasonCode,
        attempt,
      });
      if (DEBUG_INGEST) {
        console.warn(`${LOG_PREFIX} HTML response headers`, {
          ...attemptInfo,
          headers: redactSensitiveHeaders(Object.fromEntries(headers.entries())),
        });
      }
    }

    const isJsonLike = trimmed.startsWith('{') || trimmed.startsWith('[');
    if (!bodyText.length || !isJsonLike) {
      if (bodyText.length && !isJsonLike) {
        lastFailureReason = 'non-json';
        logUpstreamResponseDebug({
          status,
          contentType,
          contentLength,
          bodyText: trimmed,
          monthFilter,
          league,
          seasonCode,
          attempt,
        });
      }
      console.warn(`${LOG_PREFIX} Non-JSON or empty response, will retry`, attemptInfo);
    } else {
      try {
        payload = JSON.parse(trimmed);
        break;
      } catch (err) {
        lastFailureReason = 'json-parse-failed';
        console.warn(`${LOG_PREFIX} JSON parse failed, will retry`, { ...attemptInfo, err });
      }
    }

    if (attempt >= maxRetries) {
      console.warn(`${LOG_PREFIX} Upstream returned 200 with empty body; likely blocked or upstream bug.`, {
        monthFilter,
        league,
        seasonCode,
        speluVeids,
        reason: lastFailureReason,
      });
      throw new Error(`Failed to fetch month ${monthFilter}: non-JSON/empty after ${maxRetries} attempts`);
    }
    const jitter = Math.floor(Math.random() * 251);
    const backoffMs = retryBackoffMs[Math.min(attempt - 1, retryBackoffMs.length - 1)];
    await sleep(backoffMs + jitter);
  }

  const aaData = Array.isArray(payload?.aaData) ? payload.aaData : [];
  const totalRecords = Number(payload?.iTotalRecords ?? payload?.iTotalDisplayRecords ?? aaData.length ?? 0);
  console.log(`${LOG_PREFIX} Month ${monthFilter} aaData length`, { rows: aaData.length, totalRecords });

  return { aaData, totalRecords };
}

async function fetchMonthOptions(params: {
  env: ReturnType<typeof getEnv>;
  seasonCode: string;
  league: string;
  speluVeids: string;
}): Promise<string[]> {
  const { env, seasonCode, league, speluVeids } = params;
  const url = 'https://www.floorball.lv/ajax/ajax_chempionats_kalendars_meneshi.php';
  const bodyParams = new URLSearchParams({
    sezona: seasonCode,
    grupa: league,
    filtrs_spelu_veids: speluVeids,
  });

  console.log(`${LOG_PREFIX} Fetching month options`, { url, seasonCode, league, speluVeids });
  const { body } = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': env.userAgent,
      cookie: env.cookie,
    },
    body: bodyParams.toString(),
  });

  const $ = loadHtml(body);
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
  const hasCookie = Boolean(env.cookie?.trim());
  console.log(`${LOG_PREFIX} Request auth headers`, { has_cookie: hasCookie });
  if (process.env.CI && !hasCookie) {
    throw new Error('Missing LFS cookie in CI (env.cookie empty)');
  }
  const supa = createSupabase(env);
  const ajaxUrl = 'https://www.floorball.lv/ajax/ajax_chempionats_kalendars.php';
  const seasonCode = '34';
  const speluVeids = DEFAULT_SPELU_VEIDS;

  const monthOptions = await fetchMonthOptions({ env, seasonCode, league, speluVeids });
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
      result = await fetchCalendarPages(env, ajaxUrl, league, seasonCode, monthFilter, speluVeids);
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
    if (IS_CI) {
      console.warn(`${LOG_PREFIX} Upstream returned empty/non-JSON for all months - likely blocked or endpoint changed`, summary);
      console.warn(`${LOG_PREFIX} skipped ingest due to upstream instability`);
      return { inserted: 0, skipped: true };
    }
    console.error(`${LOG_PREFIX} Upstream returned empty/non-JSON for all months - likely blocked or endpoint changed`, summary);
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
    if (IS_CI) {
      console.warn(`${LOG_PREFIX} skipped ingest due to upstream instability`, summary);
      return { inserted: 0, skipped: true };
    }
    console.error(`${LOG_PREFIX} Upstream instability detected with zero fetched rows`, summary);
    process.exitCode = 1;
    throw new Error('Zero rows fetched with upstream month failures');
  }

  if (combinedAaDataCount === 0 && !allCalendarRows.length && failedMonths.length === 0) {
    console.log(`${LOG_PREFIX} No new matches for selected filters`);
    return { inserted: 0, skipped: false };
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
