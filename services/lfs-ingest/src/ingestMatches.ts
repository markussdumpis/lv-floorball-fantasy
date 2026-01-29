import { URL } from 'node:url';
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
const DEFAULT_PAGE_LENGTH = 100;
const DEFAULT_SPELU_VEIDS = '00';

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

  const { data, error, count } = await client
    .from('matches')
    .upsert(rowsToUpsert, { onConflict: 'season,date,home_team,away_team', ignoreDuplicates: false })
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
  let start = 0;
  let sEcho = 1;
  let totalRecords = Number.POSITIVE_INFINITY;
  const acc: unknown[] = [];
  let page = 0;

  while (start < totalRecords) {
    page += 1;
    console.log(`${LOG_PREFIX} Fetching page`, {
      ajaxUrl,
      league,
      seasonCode,
      monthFilter,
      start,
      length: DEFAULT_PAGE_LENGTH,
      sEcho,
      speluVeids,
    });
    const params = new URLSearchParams({
      url: 'https://www.floorball.lv/lv',
      menu: 'chempionats',
      filtrs_grupa: league,
      filtrs_sezona: seasonCode,
      filtrs_spelu_veids: speluVeids,
      filtrs_menesis: monthFilter,
      filtrs_komanda: '00',
      filtrs_majas_viesi: '00',
      iDisplayStart: String(start),
      iDisplayLength: String(DEFAULT_PAGE_LENGTH),
      sEcho: String(sEcho),
    });

    const { body, status, headers } = await fetchWithRetry(ajaxUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': env.userAgent,
        cookie: env.cookie,
      },
      body: params.toString(),
    });
    const contentType = headers.get('content-type') ?? 'unknown';
    console.log(`${LOG_PREFIX} Response status ${status}, content-type ${contentType}`);

    const bodyText = body?.toString() ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      console.error(`${LOG_PREFIX} Unexpected content-type, expected JSON`);
      console.error(bodyText.slice(0, 500));
      throw new Error('Expected JSON but received HTML');
    }

    let payload: any;
    try {
      payload = JSON.parse(bodyText);
    } catch (err) {
      console.error(`${LOG_PREFIX} Failed to parse JSON`, err);
      console.error(bodyText.slice(0, 500));
      throw err;
    }

    const pageTotal = Number(payload?.iTotalRecords ?? payload?.iTotalDisplayRecords ?? 0);
    if (!Number.isFinite(totalRecords) || totalRecords === Number.POSITIVE_INFINITY) {
      totalRecords = pageTotal;
      console.log(`${LOG_PREFIX} totalRecords from first page: ${totalRecords}`);
    }

    const pageData = Array.isArray(payload?.aaData) ? payload.aaData : [];
    const pageLength = pageData.length;
    console.log(`${LOG_PREFIX} Page ${page} aaData length: ${pageLength}`);

    acc.push(...pageData);

    if (pageLength === 0) {
      break;
    }

    start += DEFAULT_PAGE_LENGTH;
    sEcho += 1;
    if (start >= totalRecords) {
      break;
    }
  }

  return { aaData: acc, totalRecords: Number.isFinite(totalRecords) ? totalRecords : acc.length };
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

async function main(): Promise<void> {
  const { season, league } = parseArgs();
  const env = getEnv();
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

  for (const monthFilter of monthsToFetch) {
    console.log(`${LOG_PREFIX} Fetching calendar AJAX`, { ajaxUrl, league, seasonCode, monthFilter });
    const result = await fetchCalendarPages(env, ajaxUrl, league, seasonCode, monthFilter, speluVeids);
    combinedAaDataCount += result.aaData.length;
    console.log(`${LOG_PREFIX} Month ${monthFilter} totals: totalRecords=${result.totalRecords}, totalRowsFetched=${result.aaData.length}`);

    const { rows: calendarRows, noProtocolCount } = parseAjaxRows(result.aaData, season);
    console.log(`${LOG_PREFIX} Month ${monthFilter} parsed rows=${calendarRows.length}, noProtocol=${noProtocolCount}`);
    totalNoProtocolCount += noProtocolCount;
    allCalendarRows.push(...calendarRows);
  }

  console.log(`${LOG_PREFIX} Total raw rows fetched across months: ${combinedAaDataCount}`);
  console.log(`${LOG_PREFIX} Total fetched from LFS`, { rows: combinedAaDataCount });

  if (!allCalendarRows.length) {
    throw new Error('No calendar rows parsed');
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
