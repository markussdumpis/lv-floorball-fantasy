import { URL } from 'node:url';
import { writeFile } from 'node:fs/promises';
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
  const defaults = { season: '2025', league: 'vv' };

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

  const year = parsedYear && parsedYear < 100 ? 2000 + parsedYear : parsedYear ?? Number.parseInt(seasonYear, 10);
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
  try {
    const url = new URL(href, 'https://www.floorball.lv');
    const parts = url.pathname.split('/proto/')[1];
    if (!parts) return null;
    const segments = parts.split('/').filter(Boolean);
    return segments.length ? segments[segments.length - 1] : null;
  } catch {
    return null;
  }
}

function parseAjaxRows(aaData: unknown[], seasonYear: string): { rows: CalendarRow[]; noProtocolCount: number } {
  const rows: CalendarRow[] = [];
  let noProtocolCount = 0;

  aaData.forEach((entry) => {
    if (!Array.isArray(entry) || entry.length < 6) return;
    const [dateCell, timeCell, homeCell, resultCell, awayCell, venueCell] = entry as Array<string>;

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

    const resultHtml = resultCell ?? '';
    const $ = loadHtml(resultHtml);
    const linkHref = $('a[href*="/proto/"]').attr('href') ?? null;
    const protocolId = extractProtocolId(linkHref);
    if (!protocolId) {
      noProtocolCount += 1;
    }
    const scoreText = stripHtml(resultHtml);

    rows.push({
      date: parsedDate,
      homeName: homeText,
      awayName: awayText,
      venue: venueText || null,
      protocolId,
      hasProtocolLink: Boolean(protocolId),
      scoreText: scoreText || null,
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
    const protocolId = row.protocolId;
    const score = parseScore(row.scoreText);
    const status = score ? 'finished' : 'scheduled';
    return {
      date: row.date,
      homeName: row.homeName,
      awayName: row.awayName,
      venue: row.venue,
      protocolId,
      resultText: row.scoreText ?? null,
      status,
      homeScore: score ? score.home : null,
      awayScore: score ? score.away : null,
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
): Promise<{ upserted: number; skipped: number }> {
  let skipped = 0;
  const unmappedTeams: Set<string> = new Set();
  const rowsToUpsert: Array<Record<string, unknown>> = [];

  matches.forEach((match) => {
    const home = mapTeamId(match.homeName, teams);
    const away = mapTeamId(match.awayName, teams);

    if (!home || !away) {
      skipped += 1;
      if (!home) unmappedTeams.add(match.homeName);
      if (!away) unmappedTeams.add(match.awayName);
      console.warn(`${LOG_PREFIX} UNMAPPED_TEAM`, { home: match.homeName, away: match.awayName });
      return;
    }

    const fallbackExternalId = `${league}:${seasonCode}:${match.date.toISOString().split('T')[0]}:${home.code}:${away.code}`;
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
  });

  console.log(`${LOG_PREFIX} Parsed ${matches.length} matches; upserting ${rowsToUpsert.length}; skipped ${skipped}`);
  if (unmappedTeams.size > 0) {
    console.warn(`${LOG_PREFIX} Unmapped teams: ${Array.from(unmappedTeams).join(', ')}`);
  }

  if (!rowsToUpsert.length) {
    return { upserted: 0, skipped };
  }

  const { error, count } = await client
    .from('matches')
    .upsert(rowsToUpsert, { onConflict: 'external_id', ignoreDuplicates: false })
    .select('id', { count: 'exact' });

  if (error) {
    throw error;
  }

  console.log(`${LOG_PREFIX} Upserted ${count ?? rowsToUpsert.length} rows`);
  return { upserted: count ?? rowsToUpsert.length, skipped };
}

async function main(): Promise<void> {
  const { season, league } = parseArgs();
  const env = getEnv();
  const supa = createSupabase(env);
  const ajaxUrl = 'https://www.floorball.lv/ajax/ajax_chempionats_kalendars.php';
  const seasonCode = '34';

  const params = new URLSearchParams({
    url: 'https://www.floorball.lv/lv',
    menu: 'chempionats',
    filtrs_grupa: league,
    filtrs_sezona: seasonCode,
    filtrs_spelu_veids: '00',
    filtrs_menesis: '00',
    filtrs_komanda: '00',
    filtrs_majas_viesi: '00',
    iDisplayStart: '0',
    iDisplayLength: '5000',
    sEcho: '1',
  });

  console.log(`${LOG_PREFIX} Fetching calendar AJAX`, { ajaxUrl, league, seasonCode });
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
  console.log(`${LOG_PREFIX} Body preview (1000 chars): ${body.slice(0, 1000)}`);

  const dumpPath = '/tmp/lfs-calendar.html';
  try {
    await writeFile(dumpPath, body, 'utf8');
    console.log(`${LOG_PREFIX} Saved calendar response to ${dumpPath}`);
  } catch (err) {
    console.warn(`${LOG_PREFIX} Failed to save response to ${dumpPath}:`, err);
  }

  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed to parse JSON`, err);
    return;
  }

  const responseKeys = Object.keys(payload ?? {});
  const aaData = Array.isArray(payload?.aaData) ? payload.aaData : [];
  console.log(`${LOG_PREFIX} Response keys: ${responseKeys.join(', ')}`);
  console.log(`${LOG_PREFIX} aaData length: ${aaData.length}`);

  const { rows: calendarRows, noProtocolCount } = parseAjaxRows(aaData, season);
  if (!calendarRows.length) {
    console.warn(`${LOG_PREFIX} No calendar rows parsed; exiting`);
    return;
  }

  const parsedMatches = buildParsedMatches(calendarRows);
  console.log(`${LOG_PREFIX} Parsed rows`, { parsed: parsedMatches.length, noProtocolCount });
  console.log(`${LOG_PREFIX} Rows without protocol link: ${noProtocolCount}`);

  const teams = await loadTeams(supa.client);
  console.log(`${LOG_PREFIX} Loaded ${teams.length} teams for mapping`);

  const { upserted, skipped } = await upsertMatches(
    supa.client,
    parsedMatches,
    season,
    league,
    seasonCode,
    teams,
  );

  const finishedCount = parsedMatches.filter((m) => m.status === 'finished').length;
  const scheduledCount = parsedMatches.filter((m) => m.status === 'scheduled').length;
  const withProtocolCount = parsedMatches.filter((m) => Boolean(m.protocolId)).length;
  const withoutProtocolCount = parsedMatches.length - withProtocolCount;

  console.log(
    `${LOG_PREFIX} Summary: aaData=${aaData.length}, parsed=${parsedMatches.length}, upserted=${upserted}, skipped=${skipped}, finished=${finishedCount}, scheduled=${scheduledCount}, protocolLinks=${withProtocolCount}, withoutProtocol=${withoutProtocolCount}`,
  );

  const examples = parsedMatches.slice(0, 3).map((m) => {
    const dateIso = m.date.toISOString();
    const protoOrFallback =
      m.protocolId ?? `${league}:${seasonCode}:${m.date.toISOString().split('T')[0]}:${normalize(m.homeName)}:${normalize(m.awayName)}`;
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
