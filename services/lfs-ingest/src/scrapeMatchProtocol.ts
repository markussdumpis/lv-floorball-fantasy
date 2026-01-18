import { pathToFileURL } from 'node:url';
import { load, type CheerioAPI, type Element } from 'cheerio';
import { getEnv } from './env.js';
import { fetchWithRetry } from './http.js';
import { cleanText, extractCleanName } from './html.js';
import { createSupabase } from './supa.js';

type MatchRow = {
  id: string;
  external_id?: string | null;
  lfs_match_url?: string | null;
  protocol_url?: string | null;
  home_team?: string | null;
  away_team?: string | null;
};

type TeamRow = {
  id: string;
  name?: string | null;
  code?: string | null;
  external_id?: string | null;
};

type PlayerRow = {
  id: string;
  name?: string | null;
  team?: string | null;
  team_id?: string | null;
  jersey_number?: string | null;
  external_id?: string | null;
};

type ParsedEvent = {
  rawTeam?: string | null;
  rawPlayer?: string | null;
  event_type: string;
  ts_seconds: number | null;
  minute: number | null;
  period: number | null;
  value: number | null;
};

type InsertableEvent = {
  match_id: string;
  team_id: string | null;
  player_id: string | null;
  event_type: string;
  ts_seconds: number | null;
  minute: number | null;
  period: number | null;
  value: number | null;
  raw_player?: string | null;
  raw_team?: string | null;
};

type ParsedRow = {
  team: string | null;
  scorer: string | null;
  assists: string[];
  time: string | null;
  period: string | null;
};

type ParsedPenaltyRow = {
  team: string | null;
  player: string | null;
  minutes: number | null;
  time: string | null;
  period: string | null;
  description?: string | null;
};

const GOAL_HEADER_KEYWORDS = ['goal', 'goals', 'varti', 'scorer', 'aizs', 'assists', 'piesp'];
const PENALTY_HEADER_KEYWORDS = ['pen', 'sods', 'sodu', 'pim', 'minutes', 'min', 'sodi'];

function usage(): never {
  console.error('Usage: npm run scrape:match -- <match_id>');
  process.exit(1);
}

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseTimeToSeconds(raw: string | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d:]/g, '').trim();
  const parts = cleaned.split(':').map((p) => Number.parseInt(p, 10));
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
    const [min, sec] = parts;
    return min * 60 + sec;
  }
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    const [hour, min, sec] = parts;
    return hour * 3600 + min * 60 + sec;
  }
  return null;
}

function parsePeriod(raw: string | null): number | null {
  if (!raw) return null;
  const numeric = Number.parseInt(raw.replace(/[^\d]/g, ''), 10);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  const lowered = raw.toLowerCase();
  if (lowered.includes('ot')) return 4;
  if (lowered.includes('so')) return 5; // shootout marker if present
  return null;
}

function classifyTable(headers: string[]): 'goal' | 'penalty' | null {
  const lowerHeaders = headers.map((h) => normalize(h));
  const joined = lowerHeaders.join(' ');
  const hasGoal = GOAL_HEADER_KEYWORDS.some((kw) => joined.includes(kw));
  const hasPenalty = PENALTY_HEADER_KEYWORDS.some((kw) => joined.includes(kw));
  if (hasGoal) return 'goal';
  if (hasPenalty) return 'penalty';
  return null;
}

function getHeaderTexts($: CheerioAPI, table: Element): string[] {
  const headers: string[] = [];
  $(table)
    .find('tr')
    .first()
    .find('th,td')
    .each((_, cell) => headers.push(cleanText($(cell).text())));
  return headers;
}

function parseGoalRows($: CheerioAPI, table: Element): ParsedRow[] {
  const headers = getHeaderTexts($, table);
  const rows: ParsedRow[] = [];
  $(table)
    .find('tr')
    .slice(1)
    .each((_, row) => {
      const cells = $(row).find('td');
      if (!cells.length) return;

      const values = cells
        .map((__, cell) => cleanText($(cell).text()))
        .toArray()
        .map((v) => (v ? v : ''));

      const scorer = values[2] ?? values[1] ?? null;
      const assistsRaw = values[3] ?? '';
      const assists = assistsRaw
        .split(/[,;()+]/)
        .map((v) => extractCleanName(v))
        .map((v) => v.trim())
        .filter(Boolean);
      const time = values[0] ?? null;
      const team = values[1] ?? null;
      const period = headers.find((h) => /per/i.test(h)) ? values[headers.findIndex((h) => /per/i.test(h))] : null;

      rows.push({
        team: team || null,
        scorer: scorer ? extractCleanName(scorer) : null,
        assists,
        time,
        period,
      });
    });
  return rows;
}

function parsePenaltyRows($: CheerioAPI, table: Element): ParsedPenaltyRow[] {
  const headers = getHeaderTexts($, table);
  const rows: ParsedPenaltyRow[] = [];
  $(table)
    .find('tr')
    .slice(1)
    .each((_, row) => {
      const cells = $(row).find('td');
      if (!cells.length) return;
      const values = cells
        .map((__, cell) => cleanText($(cell).text()))
        .toArray()
        .map((v) => (v ? v : ''));

      const team = values[1] ?? null;
      const player = values[2] ?? null;
      const minutesStr = values.find((v) => /\d+/.test(v)) ?? null;
      const minutes = minutesStr ? Number.parseInt(minutesStr.replace(/[^\d]/g, ''), 10) : null;
      const time = values[0] ?? null;
      const period =
        headers.find((h) => /per/i.test(h)) !== undefined
          ? values[headers.findIndex((h) => /per/i.test(h))]
          : null;

      rows.push({
        team: team || null,
        player: player ? extractCleanName(player) : null,
        minutes: Number.isFinite(minutes) ? minutes : null,
        time,
        period,
        description: values.slice(3).join(' ').trim() || null,
      });
    });
  return rows;
}

function parseProtocol(html: string) {
  const $ = load(html);
  const goalRows: ParsedRow[] = [];
  const penaltyRows: ParsedPenaltyRow[] = [];

  $('table').each((_, table) => {
    const headers = getHeaderTexts($, table);
    if (!headers.length) return;
    const kind = classifyTable(headers);
    if (kind === 'goal') {
      goalRows.push(...parseGoalRows($, table));
    } else if (kind === 'penalty') {
      penaltyRows.push(...parsePenaltyRows($, table));
    }
  });

  return { goalRows, penaltyRows };
}

function toParsedEvents(goalRows: ParsedRow[], penaltyRows: ParsedPenaltyRow[]): ParsedEvent[] {
  const events: ParsedEvent[] = [];

  for (const row of goalRows) {
    const tsSeconds = parseTimeToSeconds(row.time);
    const minute = tsSeconds !== null ? Math.floor(tsSeconds / 60) : null;
    const period = parsePeriod(row.period);

    if (row.scorer) {
      events.push({
        event_type: 'goal',
        rawTeam: row.team,
        rawPlayer: row.scorer,
        ts_seconds: tsSeconds,
        minute,
        period,
        value: null,
      });
    }

    row.assists.forEach((assistName) => {
      events.push({
        event_type: 'assist',
        rawTeam: row.team,
        rawPlayer: assistName,
        ts_seconds: tsSeconds,
        minute,
        period,
        value: null,
      });
    });
  }

  for (const row of penaltyRows) {
    const tsSeconds = parseTimeToSeconds(row.time);
    const minute = tsSeconds !== null ? Math.floor(tsSeconds / 60) : null;
    const period = parsePeriod(row.period);

    events.push({
      event_type: row.minutes && row.minutes >= 4 ? 'double_minor' : 'minor_2',
      rawTeam: row.team,
      rawPlayer: row.player,
      ts_seconds: tsSeconds,
      minute,
      period,
      value: row.minutes ?? null,
    });
  }

  return events;
}

function buildTeamLookup(teams: TeamRow[]): Map<string, string> {
  const map = new Map<string, string>();
  teams.forEach((team) => {
    const candidates = [
      team.name,
      team.code,
      team.external_id,
    ].map((c) => normalize(c));
    candidates.forEach((key) => {
      if (key) {
        map.set(key, team.id);
      }
    });
  });
  return map;
}

function buildPlayerLookup(players: PlayerRow[]): Map<string, Map<string, string>> {
  const map = new Map<string, Map<string, string>>();
  players.forEach((player) => {
    const teamKey = player.team_id ?? player.team ?? '';
    const normTeam = normalize(teamKey);
    const normName = normalize(player.name);
    if (!normName) return;
    if (!map.has(normTeam)) {
      map.set(normTeam, new Map());
    }
    map.get(normTeam)!.set(normName, player.id);
  });
  return map;
}

function resolveTeamId(teamLookup: Map<string, string>, raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = normalize(raw);
  return teamLookup.get(key) ?? null;
}

function resolvePlayerId(
  playerLookup: Map<string, Map<string, string>>,
  teamId: string | null,
  rawName: string | null | undefined,
): string | null {
  if (!rawName) return null;
  const normName = normalize(rawName);
  const teamKey = normalize(teamId ?? '');
  const exactTeamMap = playerLookup.get(teamKey);
  if (exactTeamMap?.has(normName)) {
    return exactTeamMap.get(normName) ?? null;
  }

  // Fallback: search across teams for a unique match.
  const matches: string[] = [];
  playerLookup.forEach((nameMap) => {
    if (nameMap.has(normName)) {
      matches.push(nameMap.get(normName)!);
    }
  });
  if (matches.length === 1) {
    return matches[0] ?? null;
  }
  return null;
}

async function main() {
  const matchId = process.argv[2];
  if (!matchId) {
    usage();
  }

  const env = getEnv();
  const supabase = createSupabase(env).client;

  const { data: match, error: matchError } = await supabase
    .from('matches')
    .select('*')
    .eq('id', matchId)
    .single<MatchRow>();

  if (matchError || !match) {
    console.error('[scrape] Failed to load match', matchError);
    process.exit(1);
  }

  const protocolUrl = match.lfs_match_url ?? match.protocol_url ?? null;
  if (!protocolUrl) {
    console.error(
      '[scrape] Match row is missing protocol URL (expected lfs_match_url or protocol_url). Add it and retry.',
    );
    process.exit(1);
  }

  console.log(`[scrape] Fetching protocol for match ${matchId} from ${protocolUrl}`);
  const { body: html } = await fetchWithRetry(protocolUrl);

  console.log('[scrape] Parsing protocol HTML…');
  const { goalRows, penaltyRows } = parseProtocol(html);

  if (!goalRows.length && !penaltyRows.length) {
    console.warn('[scrape] No goal or penalty rows detected; adjust parser for this protocol layout.');
  }

  const parsedEvents = toParsedEvents(goalRows, penaltyRows);

  const { data: teams, error: teamsError } = await supabase
    .from('teams')
    .select('id, name, code, external_id');

  if (teamsError || !teams) {
    console.error('[scrape] Failed to load teams for mapping', teamsError);
    process.exit(1);
  }

  const { data: players, error: playersError } = await supabase
    .from('players')
    .select('id, name, team, team_id, jersey_number, external_id');

  if (playersError || !players) {
    console.error('[scrape] Failed to load players for mapping', playersError);
    process.exit(1);
  }

  const teamLookup = buildTeamLookup(teams);
  const playerLookup = buildPlayerLookup(players);

  const unresolvedPlayers: ParsedEvent[] = [];
  const unresolvedTeams: ParsedEvent[] = [];

  const rows: InsertableEvent[] = parsedEvents.map((ev) => {
    const teamId = resolveTeamId(teamLookup, ev.rawTeam);
    const playerId = resolvePlayerId(playerLookup, teamId, ev.rawPlayer);
    if (!teamId) {
      unresolvedTeams.push(ev);
    }
    if (!playerId) {
      unresolvedPlayers.push(ev);
    }
    return {
      match_id: matchId,
      team_id: teamId,
      player_id: playerId,
      event_type: ev.event_type,
      ts_seconds: ev.ts_seconds,
      minute: ev.minute,
      period: ev.period,
      value: ev.value,
      raw_player: ev.rawPlayer ?? null,
      raw_team: ev.rawTeam ?? null,
    };
  });

  const filteredRows = rows.filter((row) => row.player_id && row.event_type);
  if (!filteredRows.length) {
    console.warn('[scrape] No rows with resolved player_id to insert.');
    return;
  }

  console.log(
    `[scrape] Prepared ${filteredRows.length} events (${parsedEvents.length} parsed, ${
      parsedEvents.length - filteredRows.length
    } skipped due to missing player_id).`,
  );

  console.log(`[scrape] Clearing existing events for match ${matchId}…`);
  const { error: deleteError } = await supabase.from('match_events').delete().eq('match_id', matchId);
  if (deleteError) {
    console.error('[scrape] Failed to delete existing match_events', deleteError);
    process.exit(1);
  }

  const { error: insertError } = await supabase.from('match_events').insert(filteredRows);
  if (insertError) {
    console.error('[scrape] Failed to insert match_events', insertError);
    process.exit(1);
  }

  const goalCount = filteredRows.filter((r) => r.event_type === 'goal').length;
  const assistCount = filteredRows.filter((r) => r.event_type === 'assist').length;
  const penaltyCount = filteredRows.filter((r) => r.event_type === 'minor_2' || r.event_type === 'double_minor').length;

  console.log(
    `[scrape] Inserted events: goals=${goalCount}, assists=${assistCount}, penalties=${penaltyCount}.`,
  );

  if (unresolvedTeams.length) {
    console.warn(`[scrape] ${unresolvedTeams.length} events had unmapped teams (kept raw_team).`);
  }
  if (unresolvedPlayers.length) {
    console.warn(
      `[scrape] ${unresolvedPlayers.length} events had unmapped players (skipped unless player_id resolved).`,
    );
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error) => {
    console.error('[scrape] Fatal error', error);
    process.exitCode = 1;
  });
}
