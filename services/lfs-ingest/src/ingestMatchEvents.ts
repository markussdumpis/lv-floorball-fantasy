import type { CheerioAPI } from 'cheerio';
import type { SupabaseClient } from '@supabase/supabase-js';
import { writeFile } from 'node:fs/promises';
import { getEnv } from './env.js';
import { fetchWithRetry } from './http.js';
import { cleanText, extractCleanName, loadHtml } from './html.js';
import { createSupabase } from './supa.js';

const GOALIE_LOG_MATCH_ID = 'b02f425f-ee8c-4b97-9736-e6b6c7d0eb60';

type MatchRow = {
  id: string;
  external_id: string;
  home_team: string;
  away_team: string;
  date: string | null;
  season: string | null;
};

type TeamRow = {
  id: string;
  name: string | null;
  code: string | null;
  short_name?: string | null;
};

type PlayerRow = {
  id: string;
  name: string | null;
  team_id: string;
};

type GoalieStart = {
  raw: string;
  teamLabel: string | null;
  jerseyNumber: string | null;
  name: string;
};

type GoalieLine = {
  raw: string;
  jerseyNumber: string | null;
  name: string;
  goalsAgainst: number | null;
  shots: number | null;
  minutesSeconds: number | null;
};

type InsertableGoalieStat = {
  match_id: string;
  player_id: string;
  team_id: string;
  shots: number | null;
  saves: number;
  goals_against: number;
  minutes_seconds: number | null;
};

type ParsedGoal = {
  timeText: string | null;
  scorerRaw: string | null;
  scorerNormalized: string | null;
  assistRaw: string | null;
  assistNormalized: string | null;
  teamSide: 'home' | 'away' | null;
  period: number | null;
  scoreText: string | null;
  typeText: string | null;
  detailsText: string;
};

type ParsedPenalty = {
  timeText: string | null;
  playerPart: string | null;
  playerNormalized: string | null;
  minutes: number | null;
  teamSide: 'home' | 'away' | null;
  period: number | null;
  detailsText: string;
  servedByNumber: string | null;
  servedByName: string | null;
};

type ParsedMvp = {
  timeText: string | null;
  jerseyNumber: string | null;
  name: string;
  raw: string;
};

type InsertableEvent = {
  match_id: string;
  ts_seconds: number | null;
  period: number | null;
  team_id: string;
  player_id: string | null;
  assist_id: string | null;
  event_type: 'goal' | 'minor_2' | 'double_minor' | 'misconduct_10' | 'red_card' | 'mvp';
  value: number | null;
  raw: unknown;
  created_at: string;
};

const LOG_PREFIX = '[ingest:match-events]';

function normalizeWhitespace(value: string | null | undefined): string {
  return cleanText((value ?? '').replace(/\u00a0/g, ' ')).replace(/\s+/g, ' ').trim();
}

function stripJerseyNumber(value: string | null | undefined): string {
  const cleaned = normalizeWhitespace(value);
  return cleaned.replace(/(?:#|nr\.?\s*)\d+\s*/gi, '').trim();
}

function extractJerseyNumber(value: string | null | undefined): string | null {
  const match = (value ?? '').match(/(?:#|nr\.?\s*)(\d{1,3})/i);
  return match ? match[1] : null;
}

function stripParentheses(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\([^)]*\)\s*$/, '').trim();
}

function normalizeName(value: string | null | undefined): string {
  if (!value) return '';
  const withoutParens = stripParentheses(value);
  const withoutJersey = stripJerseyNumber(withoutParens);
  return normalizeWhitespace(withoutJersey).toLowerCase();
}

function normalizeKey(text: string | null | undefined): string {
  const cleaned = normalizeWhitespace(text);
  const trimmed = cleaned.replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '');
  return trimmed
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildNonPlayerAssistSet(teams: TeamRow[]): Set<string> {
  const set = new Set<string>();
  teams.forEach((team) => {
    [team.name, team.code, team.short_name].forEach((val) => {
      const key = normalizeKey(val);
      if (key) set.add(key);
    });
  });
  const ignored = [
    'aiztureta soda laika',
    'aizturēta soda laikā',
    'vienados nepilnos sastavos',
    'vienādos nepilnos sastāvos',
  ];
  ignored.forEach((phrase) => {
    const key = normalizeKey(phrase);
    if (key) set.add(key);
  });
  return set;
}

function isNonPlayerAssistText(text: string | null | undefined, nonPlayerSet: Set<string>): boolean {
  const normalized = normalizeKey(text);
  if (!normalized) return true;
  if (text?.trim().startsWith('(')) return true;
  if (nonPlayerSet.has(normalized)) return true;
  return false;
}

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function stripJersey(value: string | null | undefined): string {
  return cleanText(value ?? '').replace(/^#\d+\s*/, '');
}

function getArgValue(flag: string): string | null {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === flag && args[i + 1]) {
      return args[i + 1];
    }
    if (arg.startsWith(`${flag}=`)) {
      return arg.split('=')[1] ?? null;
    }
  }
  return null;
}

function parseArgs(): { matchId: string | null; allFinished: boolean } {
  const matchId = getArgValue('--matchId');
  const allFinished = process.argv
    .slice(2)
    .some((arg) => arg === '--all-finished' || arg.startsWith('--all-finished='));

  if ((matchId && allFinished) || (!matchId && !allFinished)) {
    console.error('Usage: npm run ingest:match-events -- --matchId <uuid> | --all-finished');
    process.exit(1);
  }

  if (matchId) {
    console.log(`${LOG_PREFIX} matchId:`, matchId);
  }
  if (allFinished) {
    console.log(`${LOG_PREFIX} all-finished mode enabled`);
  }

  return { matchId, allFinished };
}

function buildProtocolUrl(externalId: string | null, season: string | null): string | null {
  if (!externalId) return null;
  const numericIdMatch = externalId.match(/^(\d{3,})/);
  if (!numericIdMatch) {
    console.warn(`${LOG_PREFIX} Invalid external_id, missing numeric prefix`, { external_id: externalId });
    return null;
  }
  const numericId = numericIdMatch[1];
  const seasonPath = (season ?? '2025').split('-')[0] || '2025';
  // Default league path is vv per requirements.
  return `https://www.floorball.lv/lv/${seasonPath}/chempionats/vv/proto/${numericId}`;
}

function parseTimeToSeconds(raw: string | null): number | null {
  if (!raw) return null;
  const match = raw.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const minutes = Number.parseInt(match[1], 10);
  const seconds = Number.parseInt(match[2], 10);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return minutes * 60 + seconds;
}

function inferPeriodFromSeconds(tsSeconds: number | null): number | null {
  if (tsSeconds === null || !Number.isFinite(tsSeconds)) return null;
  if (tsSeconds <= 20 * 60) return 1;
  if (tsSeconds <= 40 * 60) return 2;
  if (tsSeconds <= 60 * 60) return 3;
  return 4;
}

function parseMinutesSeconds(raw: string | null): number | null {
  if (!raw) return null;
  const match = raw.match(/(\d{1,3}):(\d{2})/);
  if (!match) return null;
  const minutes = Number.parseInt(match[1], 10);
  const seconds = Number.parseInt(match[2], 10);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return minutes * 60 + seconds;
}

function parsePenaltyDetail(detailText: string): {
  playerPart: string | null;
  minutesTotal: number | null;
  reason: string | null;
  servedBy: { number?: string; name?: string } | null;
} {
  const trimmed = normalizeWhitespace(detailText);
  const firstParenIdx = trimmed.indexOf('(');
  const playerPart = firstParenIdx === -1 ? trimmed || null : trimmed.slice(0, firstParenIdx).trim() || null;

  const insideMatch = trimmed.slice(firstParenIdx === -1 ? trimmed.length : firstParenIdx).match(/\(([^)]*)\)/);
  const inside = insideMatch?.[1] ?? '';

  let minutesTotal: number | null = null;
  if (/24\s*min/i.test(inside)) {
    minutesTotal = 24;
  } else if (/12\s*min/i.test(inside)) {
    minutesTotal = 12;
  } else if (/2\s*\+\s*2/i.test(inside) || /4\s*min/i.test(inside)) {
    minutesTotal = 4;
  } else if (/2\s*min/i.test(inside)) {
    minutesTotal = 2;
  }

  const reason =
    inside.includes(';') && inside.split(';')[1] ? stripParentheses(inside.split(';').slice(1).join(';')).trim() : null;

  let servedBy: { number?: string; name?: string } | null = null;
  const servedByMatch = trimmed.match(/sodu izcieš[^0-9]*?(?:nr\.?\s*)?(\d{1,3})?\s*([^)]+)/i);
  if (servedByMatch) {
    const servedNumber = servedByMatch[1] ? servedByMatch[1].trim() : undefined;
    const servedName = servedByMatch[2] ? normalizeWhitespace(stripJersey(servedByMatch[2])) : undefined;
    servedBy = { number: servedNumber, name: servedName };
  }

  return { playerPart, minutesTotal, reason: reason || null, servedBy };
}

function parseGoalsFromHtml(html: string): { goals: ParsedGoal[]; penalties: ParsedPenalty[]; rowsScanned: number } {
  const $ = loadHtml(html);
  const goals: ParsedGoal[] = [];
  const penalties: ParsedPenalty[] = [];
  let rowsScanned = 0;
  let currentPeriod = 1;

  $('tr').each((_, row) => {
    rowsScanned += 1;
    const rowText = cleanText($(row).text());
    if (/1\.\s*period/i.test(rowText)) currentPeriod = 1;
    if (/2\.\s*period/i.test(rowText)) currentPeriod = 2;
    if (/3\.\s*period/i.test(rowText)) currentPeriod = 3;

    const cells = $(row).find('td').toArray();
    if (cells.length !== 4) {
      return;
    }

    const typeText = cleanText($(cells[1]).text());
    const className = ($(cells[0]).attr('class') ?? '').toLowerCase();
    const teamSide = className.includes('maj') ? 'home' : className.includes('vie') ? 'away' : null;

    const timeText = cleanText($(cells[0]).text());
    const scoreText = cleanText($(cells[2]).text());
    const detailsText = cleanText($(cells[3]).text());

    if (/sods/i.test(typeText)) {
      const parsed = parsePenaltyDetail(detailsText);
      const playerNormalized = parsed.playerPart ? normalizeName(parsed.playerPart) : null;
      penalties.push({
        timeText,
        playerPart: parsed.playerPart,
        playerNormalized,
        minutes: parsed.minutesTotal,
        teamSide,
        period: currentPeriod,
        detailsText,
        servedByName: parsed.servedBy?.name ?? null,
        servedByNumber: parsed.servedBy?.number ?? null,
      });
      return;
    }

    if (!/^vārti/i.test(typeText)) {
      return;
    }

    const scorerRaw = detailsText.split('(')[0] ?? '';
    const scorerNormalized = scorerRaw ? normalizeName(scorerRaw) : null;
    const assistRaw = (() => {
      const match = detailsText.match(/\(([^)]+)\)/);
      return match ? match[1] : '';
    })();
    const assistNormalized = assistRaw ? normalizeName(assistRaw.split(';')[0].split(',')[0]) : null;

    goals.push({
      timeText,
      scorerRaw: scorerRaw || null,
      scorerNormalized,
      assistRaw: assistRaw || null,
      assistNormalized,
      teamSide,
      period: currentPeriod,
      scoreText,
      typeText,
      detailsText,
    });
  });

  return { goals, penalties, rowsScanned };
}

function parseMvpFromHtml(html: string): ParsedMvp[] {
  const text = cleanText(loadHtml(html).text());
  const results: ParsedMvp[] = [];
  const regex =
    /(\d{1,2}:\d{2})\s+Labākais\s+spēlētājs\s*(?:[^#\d]*(?:#|nr\.?)\s*)?(\d{1,3})?\s*([^\d]{2,80}?)(?=\s+\d{1,2}:\d{2}\s|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const timeText = match[1] ? match[1].trim() : null;
    const jerseyNumber = match[2] ? match[2].trim() : null;
    const name = normalizeWhitespace(match[3] ?? '');
    if (!name) continue;
    results.push({ timeText, jerseyNumber, name, raw: match[0] });
  }
  return results;
}

function parseGoalieStartsFromHtml(html: string): GoalieStart[] {
  const text = cleanText(loadHtml(html).text());
  const results: GoalieStart[] = [];
  const regex = /v\u0101rtos\s*\(([^)]*)\)\s*v\u0101rtos\s*-\s*#?(\d{1,3})?\s*([^;]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const teamLabel = normalizeWhitespace(match[1] ?? '');
    const jerseyNumber = match[2] ? match[2].trim() : null;
    const name = normalizeWhitespace(match[3] ?? '');
    if (!name) continue;
    results.push({
      raw: match[0],
      teamLabel: teamLabel || null,
      jerseyNumber,
      name,
    });
  }
  return results;
}

function parseGoalieStatsFromHtml(html: string): GoalieLine[] {
  const text = cleanText(loadHtml(html).text());
  const results: GoalieLine[] = [];
  const regex =
    /v\u0101rtsarga stat\.?\s*#?(\d{1,3})?\s*([^-]+?)-\s*v\u0101rti:\s*(\d+)\s*;\s*metieni:\s*(\d+)\s*;\s*min\u016btes:\s*([0-9]{1,3}:[0-9]{2})/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const jerseyNumber = match[1] ? match[1].trim() : null;
    const name = normalizeWhitespace(match[2] ?? '');
    const goalsAgainst = Number.parseInt(match[3] ?? '', 10);
    const shots = Number.parseInt(match[4] ?? '', 10);
    const minutesSeconds = parseMinutesSeconds(match[5] ?? null);
    if (!name) continue;
    results.push({
      raw: match[0],
      jerseyNumber,
      name,
      goalsAgainst: Number.isFinite(goalsAgainst) ? goalsAgainst : null,
      shots: Number.isFinite(shots) ? shots : null,
      minutesSeconds,
    });
  }
  if (!results.length && /v\u0101rtsarga stat/i.test(text)) {
    const rawLines = text.match(/v\u0101rtsarga stat[^;]+/gi) ?? [];
    console.warn(`${LOG_PREFIX} RAW_GOALIE_STAT_LINE_PARSE_FAIL`, rawLines.slice(0, 5));
  }
  return results;
}

async function fetchMatch(client: ReturnType<typeof createSupabase>['client'], matchId: string) {
  const { data, error } = await client
    .from('matches')
    .select('id, external_id, home_team, away_team, date, season')
    .eq('id', matchId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error(`Match not found for id ${matchId}`);
  }
  return data as MatchRow;
}

async function fetchTeams(
  client: ReturnType<typeof createSupabase>['client'],
  ids: string[],
  selectCols: string,
): Promise<TeamRow[]> {
  const { data, error } = await client.from('teams').select(selectCols).in('id', ids);
  if (error) {
    throw error;
  }
  return (data ?? []) as unknown as TeamRow[];
}

async function fetchAllTeams(
  client: ReturnType<typeof createSupabase>['client'],
  selectCols: string,
): Promise<TeamRow[]> {
  const { data, error } = await client.from('teams').select(selectCols);
  if (error) {
    throw error;
  }
  return (data ?? []) as unknown as TeamRow[];
}

async function resolveTeamSelect(client: ReturnType<typeof createSupabase>['client']): Promise<string> {
  const { data, error } = await client.from('teams').select('*').limit(1);
  if (error) {
    console.warn(`${LOG_PREFIX} Failed to inspect teams schema, defaulting without short_name`, error);
    return 'id, name, code';
  }
  const sample = (data ?? [])[0] as Record<string, unknown> | undefined;
  const hasShortName = sample ? Object.prototype.hasOwnProperty.call(sample, 'short_name') : false;
  return hasShortName ? 'id, name, code, short_name' : 'id, name, code';
}

async function fetchPlayers(
  client: ReturnType<typeof createSupabase>['client'],
  teamIds: string[],
): Promise<PlayerRow[]> {
  const { data, error } = await client
    .from('players')
    .select('id, name, team_id')
    .in('team_id', teamIds);
  if (error) {
    throw error;
  }
  return (data ?? []) as PlayerRow[];
}

async function fetchCurrentSeason(client: SupabaseClient): Promise<string> {
  const { data, error } = await client
    .from('matches')
    .select('season')
    .not('season', 'is', null)
    .order('season', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data?.season) {
    throw new Error('Unable to determine current season');
  }

  return data.season as string;
}

async function fetchFinishedMatches(client: SupabaseClient, season: string): Promise<MatchRow[]> {
  const { data, error } = await client
    .from('matches')
    .select('id, external_id, home_team, away_team, date, season')
    .eq('status', 'finished')
    .eq('season', season)
    .not('external_id', 'is', null)
    .neq('external_id', '')
    .not('external_id', 'like', 'vv:%')
    .order('date', { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as MatchRow[];
}

function resolveTeamId(teamName: string | null, teams: TeamRow[], homeId: string, awayId: string): string | null {
  if (!teamName) return null;
  const norm = normalize(teamName);
  for (const team of teams) {
    if (normalize(team.name) === norm || normalize(team.code) === norm) {
      return team.id;
    }
  }

  const home = teams.find((t) => t.id === homeId);
  const away = teams.find((t) => t.id === awayId);
  if (home && norm && normalize(home.name) && norm.includes(normalize(home.name ?? ''))) return home.id;
  if (away && norm && normalize(away.name) && norm.includes(normalize(away.name ?? ''))) return away.id;
  return null;
}

function buildPlayerIndex(players: PlayerRow[]): Map<string, string> {
  const map = new Map<string, string>();
  players.forEach((player) => {
    const key = `${player.team_id}:${normalizeName(player.name)}`;
    map.set(key, player.id);
  });
  return map;
}

function mapPlayerId(
  name: string | null,
  teamId: string,
  playerIndex: Map<string, string>,
): string | null {
  if (!name) return null;
  const normalized = normalizeName(name);
  return playerIndex.get(`${teamId}:${normalized}`) ?? null;
}

function mapPlayerIdAnyTeam(name: string | null, playerIndex: Map<string, string>): { playerId: string; teamId: string } | null {
  if (!name) return null;
  const normalized = normalizeName(name);
  const matches: { playerId: string; teamId: string }[] = [];
  playerIndex.forEach((value, key) => {
    const [, normName] = key.split(':');
    if (normName === normalized) {
      const teamId = key.split(':')[0];
      matches.push({ playerId: value, teamId });
    }
  });
  if (matches.length === 1) {
    return matches[0];
  }
  return null;
}

function resolveGoalieTeamId(teamLabel: string | null, teams: TeamRow[], homeId: string, awayId: string): string | null {
  if (!teamLabel) return null;
  const normalizedLabel = normalize(teamLabel);
  const home = teams.find((t) => t.id === homeId);
  const away = teams.find((t) => t.id === awayId);

  for (const team of teams) {
    const nameNorm = normalize(team.name);
    const codeNorm = normalize(team.code);
    if (normalizedLabel === nameNorm || normalizedLabel === codeNorm) {
      return team.id;
    }
    if (nameNorm && normalizedLabel.includes(nameNorm)) {
      return team.id;
    }
    if (codeNorm && normalizedLabel.includes(codeNorm)) {
      return team.id;
    }
  }

  if (/maj/i.test(teamLabel)) return homeId;
  if (/vie/i.test(teamLabel)) return awayId;

  if (home && normalizedLabel === normalize(home.name)) return home.id;
  if (away && normalizedLabel === normalize(away.name)) return away.id;
  return null;
}

function buildGoalieTeamLookup(starts: GoalieStart[], teams: TeamRow[], match: MatchRow): Map<string, string> {
  const map = new Map<string, string>();
  starts.forEach((start) => {
    const teamId = resolveGoalieTeamId(start.teamLabel, teams, match.home_team, match.away_team);
    if (!teamId) return;
    if (start.jerseyNumber) {
      map.set(`jersey:${start.jerseyNumber}`, teamId);
    }
    const normalized = normalizeName(start.name);
    if (normalized) {
      map.set(`name:${normalized}`, teamId);
    }
  });
  return map;
}

function resolveGoalieTeamFromLine(
  line: GoalieLine,
  lookup: Map<string, string>,
  match: MatchRow,
): string | null {
  if (line.jerseyNumber) {
    const byJersey = lookup.get(`jersey:${line.jerseyNumber}`);
    if (byJersey) return byJersey;
  }

  const byName = lookup.get(`name:${normalizeName(line.name)}`);
  if (byName) return byName;

  // Fallback: if two goalies and one already mapped, assign the other to the remaining team.
  const teamsFound = new Set<string>(Array.from(lookup.values()));
  if (teamsFound.size === 1) {
    const only = Array.from(teamsFound)[0];
    if (only === match.home_team) return match.away_team;
    if (only === match.away_team) return match.home_team;
  }

  return null;
}

async function upsertMatchGoalieStats(
  client: SupabaseClient,
  matchId: string,
  rows: InsertableGoalieStat[],
): Promise<number> {
  if (!rows.length) {
    return 0;
  }

  const { error, count } = await client
    .from('match_goalie_stats')
    .upsert(rows, { onConflict: 'match_id,player_id', count: 'exact' });
  if (error) {
    throw error;
  }
  return count ?? rows.length;
}

async function ingestSingleMatch(
  supa: ReturnType<typeof createSupabase>,
  env: ReturnType<typeof getEnv>,
  match: MatchRow,
): Promise<{
  eventsInserted: number;
  stubPlayersCreatedScorer: number;
  stubPlayersCreatedAssist: number;
  stubPlayersCreatedPenalty: number;
  unmappedAssistCount: number;
  unmappedScorers: number;
  unmappedPenaltyPlayers: number;
  penaltiesInserted: number;
  misconductsDetected: number;
  redCardsDetected: number;
  goalieStatsInserted: number;
}> {
  const protocolUrl = buildProtocolUrl(match.external_id, match.season);
  if (!protocolUrl) {
    console.warn(`${LOG_PREFIX} Invalid external_id, skipping match`, { match_id: match.id, external_id: match.external_id });
    return {
      eventsInserted: 0,
      stubPlayersCreatedScorer: 0,
      stubPlayersCreatedAssist: 0,
      stubPlayersCreatedPenalty: 0,
      unmappedAssistCount: 0,
      unmappedScorers: 0,
      unmappedPenaltyPlayers: 0,
      penaltiesInserted: 0,
      misconductsDetected: 0,
      redCardsDetected: 0,
      goalieStatsInserted: 0,
    };
  }
  console.log(`${LOG_PREFIX} Protocol URL: ${protocolUrl}`);

  const { body: html, status, headers } = await fetchWithRetry(protocolUrl, {
    headers: {
      'user-agent': env.userAgent,
      cookie: env.cookie,
    },
  });
  if (status === 404) {
    console.warn(`${LOG_PREFIX} protocol 404, skipping match`, { match_id: match.id, external_id: match.external_id });
    return {
      eventsInserted: 0,
      stubPlayersCreatedScorer: 0,
      stubPlayersCreatedAssist: 0,
      stubPlayersCreatedPenalty: 0,
      unmappedAssistCount: 0,
      unmappedScorers: 0,
      unmappedPenaltyPlayers: 0,
      penaltiesInserted: 0,
      misconductsDetected: 0,
      redCardsDetected: 0,
      goalieStatsInserted: 0,
    };
  }
  const contentType = headers.get('content-type') ?? 'unknown';
  console.log(`${LOG_PREFIX} Protocol response status ${status}, content-type ${contentType}`);
  const dumpPath = '/tmp/lfs-protocol-52064-lek-irl.html';
  try {
    await writeFile(dumpPath, html, 'utf8');
    console.log(`${LOG_PREFIX} Saved protocol HTML to ${dumpPath}`);
  } catch (err) {
    console.warn(`${LOG_PREFIX} Failed to save protocol HTML to ${dumpPath}:`, err);
  }
  console.log(`${LOG_PREFIX} Protocol preview (500 chars): ${html.slice(0, 500)}`);

  const { goals: parsedGoals, penalties: parsedPenalties, rowsScanned } = parseGoalsFromHtml(html);
  const parsedMvps = parseMvpFromHtml(html);
  console.log(`${LOG_PREFIX} Rows scanned: ${rowsScanned}`);
  console.log(`${LOG_PREFIX} Goals parsed: ${parsedGoals.length}`);
  console.log(`${LOG_PREFIX} Penalties parsed: ${parsedPenalties.length}`);
  console.log(`${LOG_PREFIX} MVP parsed: ${parsedMvps.length}`);
  const goalieRawLines = cleanText(loadHtml(html).text()).match(/v\u0101rtsarga stat[^;]+/gi) ?? [];

  const teamSelectCols = await resolveTeamSelect(supa.client);
  const allTeams = await fetchAllTeams(supa.client, teamSelectCols);
  const teamsById = new Map(allTeams.map((t) => [t.id, t]));
  const teams = [match.home_team, match.away_team]
    .map((id) => teamsById.get(id))
    .filter((t): t is TeamRow => Boolean(t));
  if (teams.length < 2) {
    teams.push(...(await fetchTeams(supa.client, [match.home_team, match.away_team], teamSelectCols)));
  }
  const nonPlayerAssistSet = buildNonPlayerAssistSet(allTeams);
  const players = await fetchPlayers(supa.client, [match.home_team, match.away_team]);
  const playerIndex = buildPlayerIndex(players);

  const unmappedPlayers = new Set<string>();
  let unmappedAssistCount = 0;
  let stubCreatedScorerCount = 0;
  let stubCreatedAssistCount = 0;
  let stubCreatedPenaltyCount = 0;
  let unmappedPenaltyPlayers = 0;
  let penaltiesInserted = 0;
  let misconductsDetected = 0;
  let redCardsDetected = 0;
  let goalieStatsInserted = 0;
  const events: InsertableEvent[] = [];
  const goalieStats: InsertableGoalieStat[] = [];
  let mvpInserted = 0;

  const parsedGoalieStarts = parseGoalieStartsFromHtml(html);
  const parsedGoalieStats = parseGoalieStatsFromHtml(html);
  if (match.id === GOALIE_LOG_MATCH_ID) {
    console.log(`${LOG_PREFIX} Goalie raw lines`, goalieRawLines);
    console.log(`${LOG_PREFIX} Parsed goalie stats pre-upsert`, parsedGoalieStats);
  }
  const goalieTeamLookup = buildGoalieTeamLookup(parsedGoalieStarts, teams, match);
  parsedGoalieStats.forEach((line) => {
    const teamId = resolveGoalieTeamFromLine(line, goalieTeamLookup, match);
    const cleanName = normalizeWhitespace(stripJerseyNumber(line.name));
    let resolvedTeamId = teamId;
    let playerId = resolvedTeamId ? mapPlayerId(cleanName, resolvedTeamId, playerIndex) : null;
    if (!playerId) {
      const anyTeam = mapPlayerIdAnyTeam(cleanName, playerIndex);
      if (anyTeam) {
        playerId = anyTeam.playerId;
        resolvedTeamId = resolvedTeamId ?? anyTeam.teamId;
      }
    }

    if (!resolvedTeamId) {
      console.warn(`${LOG_PREFIX} UNMAPPED_GOALIE_TEAM`, { raw: line.raw });
      return;
    }

    if (!playerId) {
      playerId = mapPlayerId(cleanName, resolvedTeamId, playerIndex);
    }
    if (!playerId) {
      console.warn(`${LOG_PREFIX} UNMAPPED_GOALIE_PLAYER`, {
        raw: line.raw,
        cleanName,
        team_id: resolvedTeamId,
      });
      return;
    }

    const goalsAgainst = Math.max(0, line.goalsAgainst ?? 0);
    const shots = Math.max(0, line.shots ?? 0);
    const saves = Math.max(0, shots - goalsAgainst);
    goalieStats.push({
      match_id: match.id,
      player_id: playerId,
      team_id: resolvedTeamId,
      shots: line.shots,
      saves,
      goals_against: goalsAgainst,
      minutes_seconds: line.minutesSeconds,
    });
  });

  for (const mvp of parsedMvps) {
    const cleanName = normalizeWhitespace(stripJerseyNumber(mvp.name));
    let resolvedTeamId: string | null = null;
    let playerId: string | null = null;

    const homeCandidate = mapPlayerId(cleanName, match.home_team, playerIndex);
    const awayCandidate = mapPlayerId(cleanName, match.away_team, playerIndex);
    if (homeCandidate && !awayCandidate) {
      resolvedTeamId = match.home_team;
      playerId = homeCandidate;
    } else if (awayCandidate && !homeCandidate) {
      resolvedTeamId = match.away_team;
      playerId = awayCandidate;
    } else if (homeCandidate && awayCandidate) {
      resolvedTeamId = match.home_team;
      playerId = homeCandidate;
    } else {
      const anyTeam = mapPlayerIdAnyTeam(cleanName, playerIndex);
      if (anyTeam) {
        resolvedTeamId = anyTeam.teamId;
        playerId = anyTeam.playerId;
      }
    }

    if (!resolvedTeamId || !playerId) {
      console.warn(`${LOG_PREFIX} UNMAPPED_MVP_PLAYER`, { name: mvp.name, jersey: mvp.jerseyNumber });
      continue;
    }

    const tsSeconds = parseTimeToSeconds(mvp.timeText);
    const period = inferPeriodFromSeconds(tsSeconds);

    events.push({
      match_id: match.id,
      ts_seconds: tsSeconds,
      period,
      team_id: resolvedTeamId,
      player_id: playerId,
      assist_id: null,
      event_type: 'mvp',
      value: 1,
      raw: { type: 'mvp', timeText: mvp.timeText, name: mvp.name, jersey: mvp.jerseyNumber, raw: mvp.raw },
      created_at: new Date().toISOString(),
    });
    mvpInserted += 1;
  }

  for (const goal of parsedGoals) {
    const teamId = goal.teamSide === 'home' ? match.home_team : goal.teamSide === 'away' ? match.away_team : null;
    if (!teamId) {
      console.warn(`${LOG_PREFIX} Unable to resolve team for goal row`, goal.detailsText);
      continue;
    }

    const detailsTextLower = (goal.detailsText ?? '').toLowerCase();
    if (detailsTextLower.includes('bumbiņa savos vārtos')) {
      console.warn(`${LOG_PREFIX} IGNORED_OWN_GOAL_ROW`, { match_id: match.id, raw_row: goal.detailsText });
      continue;
    }

    let scorerId = mapPlayerId(goal.scorerNormalized, teamId, playerIndex);
    if (!scorerId) {
      const candidates = Array.from(playerIndex.entries())
        .filter(([key]) => key.startsWith(`${teamId}:`))
        .map(([key]) => key.split(':')[1])
        .slice(0, 5);

      unmappedPlayers.add(`${teamId}:${goal.scorerNormalized ?? 'unknown'}`);
      console.warn(`${LOG_PREFIX} UNMAPPED_PLAYER scorer`, {
        team_id: teamId,
        raw: goal.scorerRaw,
        normalized: goal.scorerNormalized,
        raw_row: goal.detailsText,
        candidates,
      });
      continue;
    }

    let assistId: string | null = null;
    let assistIgnoredReason: string | undefined;
    if (detailsTextLower.includes('bumbiņa savos vārtos')) {
      assistIgnoredReason = 'own_goal';
      assistId = null;
      console.warn(`${LOG_PREFIX} IGNORED_ASSIST_TEXT`, { match_id: match.id, raw: goal.assistRaw, reason: 'own_goal' });
    } else if (isNonPlayerAssistText(goal.assistRaw, nonPlayerAssistSet)) {
      assistIgnoredReason = 'non_player_assist_text';
      console.warn(`${LOG_PREFIX} IGNORED_ASSIST_TEXT`, { match_id: match.id, raw: goal.assistRaw });
    } else if (goal.assistNormalized) {
      assistId = mapPlayerId(goal.assistNormalized, teamId, playerIndex);
      if (!assistId) {
        const candidates = Array.from(playerIndex.entries())
          .filter(([key]) => key.startsWith(`${teamId}:`))
          .map(([key]) => key.split(':')[1])
          .slice(0, 5);

        unmappedAssistCount += 1;
        console.warn(`${LOG_PREFIX} UNMAPPED_ASSIST`, {
          team_id: teamId,
          raw: goal.assistRaw,
          normalized: goal.assistNormalized,
          raw_row: goal.detailsText,
          candidates,
        });
      }
    }
    // Regression note: ingesting matches 0a87bee6-c8d3-42c0-8692-f42bbc651a0f and b8a382d9-f571-4d25-a229-5077447d3941
    // should log IGNORED_ASSIST_TEXT for "FBK SĀC" assists and must not create new players.

    events.push({
      match_id: match.id,
      ts_seconds: parseTimeToSeconds(goal.timeText),
      period: goal.period,
      team_id: teamId,
      player_id: scorerId,
      assist_id: assistId,
      event_type: 'goal',
      value: null,
      raw: {
        time: goal.timeText,
        type: goal.typeText,
        scoreText: goal.scoreText,
        detailsText: goal.detailsText,
        scorer_raw: goal.scorerRaw,
        assist_raw: goal.assistRaw,
        ...(assistIgnoredReason ? { assist_ignored_reason: assistIgnoredReason } : {}),
      },
      created_at: new Date().toISOString(),
    });
  }

  for (const pen of parsedPenalties) {
    const teamId = pen.teamSide === 'home' ? match.home_team : pen.teamSide === 'away' ? match.away_team : null;
    if (!teamId) {
      console.warn(`${LOG_PREFIX} Unable to resolve team for penalty row`, pen.detailsText);
      continue;
    }

    if (!pen.playerPart) {
      console.warn(`${LOG_PREFIX} UNMAPPED_PENALTY_PLAYER`, {
        team_id: teamId,
        playerPart: pen.playerPart,
        normalizedPlayerPart: pen.playerNormalized,
        minutesTotal: pen.minutes,
        raw_row: pen.detailsText,
      });
      continue;
    }

    const lowerPart = pen.playerPart.toLowerCase();
    if (lowerPart.includes('min') || lowerPart.includes(';')) {
      console.warn(`${LOG_PREFIX} PARSE_BUG penalty player looks like reason`, {
        team_id: teamId,
        playerPart: pen.playerPart,
        normalizedPlayerPart: pen.playerNormalized,
        raw_row: pen.detailsText,
      });
      continue;
    }

    if (!pen.minutes) {
      console.warn(`${LOG_PREFIX} UNKNOWN_PENALTY minutes missing`, pen.detailsText);
      continue;
    }

    let playerId = mapPlayerId(pen.playerNormalized, teamId, playerIndex);
    if (!playerId) {
      const candidates = Array.from(playerIndex.entries())
        .filter(([key]) => key.startsWith(`${teamId}:`))
        .map(([key]) => key.split(':')[1])
        .slice(0, 5);

      unmappedPenaltyPlayers += 1;
      console.warn(`${LOG_PREFIX} UNMAPPED_PENALTY_PLAYER`, {
        team_id: teamId,
        playerPart: pen.playerPart,
        normalizedPlayerPart: pen.playerNormalized,
        minutesTotal: pen.minutes,
        raw_row: pen.detailsText,
        candidates,
      });
      continue;
    }

    const penTextLower = pen.detailsText.toLowerCase();
    const eventsForPenalty: { event_type: InsertableEvent['event_type']; value: number }[] = [];

    if (penTextLower.includes('spēles sods') || penTextLower.includes('speles sods') || pen.minutes >= 20) {
      eventsForPenalty.push({ event_type: 'red_card', value: pen.minutes });
      redCardsDetected += 1;
    } else if (pen.minutes === 12 && /sodu izcieš/i.test(pen.detailsText)) {
      eventsForPenalty.push({ event_type: 'minor_2', value: 2 });
      eventsForPenalty.push({ event_type: 'misconduct_10', value: 10 });
      misconductsDetected += 1;
    } else if (pen.minutes === 2) {
      eventsForPenalty.push({ event_type: 'minor_2', value: 2 });
    } else if (pen.minutes === 4) {
      eventsForPenalty.push({ event_type: 'double_minor', value: 4 });
    } else {
      console.warn(`${LOG_PREFIX} UNKNOWN_PENALTY`, pen.detailsText);
      continue;
    }

    for (const evt of eventsForPenalty) {
      events.push({
        match_id: match.id,
        ts_seconds: parseTimeToSeconds(pen.timeText),
        period: pen.period,
        team_id: teamId,
        player_id: playerId,
        assist_id: null,
        event_type: evt.event_type,
        value: evt.value,
        raw: {
          time: pen.timeText,
          type: 'Sods',
          detailsText: pen.detailsText,
          minutes: pen.minutes,
          served_by_number: pen.servedByNumber,
          served_by_name: pen.servedByName,
          player_raw: pen.playerPart,
        },
        created_at: new Date().toISOString(),
      });
      penaltiesInserted += 1;
    }
  }

  console.log(`${LOG_PREFIX} Goals mapped to events: ${events.filter((e) => e.event_type === 'goal').length}`);
  console.log(`${LOG_PREFIX} Penalties detected: ${parsedPenalties.length}`);
  console.log(`${LOG_PREFIX} Penalties inserted: ${penaltiesInserted}`);
  console.log(`${LOG_PREFIX} Misconducts detected: ${misconductsDetected}`);
  console.log(`${LOG_PREFIX} Red cards detected: ${redCardsDetected}`);
  console.log(
    `${LOG_PREFIX} Summary: rows_scanned=${rowsScanned}, goals_detected=${parsedGoals.length}, penalties_detected=${parsedPenalties.length}, events_insertable=${events.length}, unmapped_scorers=${unmappedPlayers.size}, unmapped_assists=${unmappedAssistCount}, unmapped_penalties=${unmappedPenaltyPlayers}, stub_players_created_scorer=${stubCreatedScorerCount}, stub_players_created_assist=${stubCreatedAssistCount}, stub_players_created_penalty=${stubCreatedPenaltyCount}`,
  );
  console.log(`${LOG_PREFIX} Goalie starts parsed: ${parsedGoalieStarts.length}, goalie stat lines parsed: ${parsedGoalieStats.length}`);

  console.log(`${LOG_PREFIX} Deleting existing events for match ${match.id}`);
  const { error: deleteError } = await supa.client.from('match_events').delete().eq('match_id', match.id);
  if (deleteError) {
    throw deleteError;
  }

  if (events.length === 0) {
    console.warn(`${LOG_PREFIX} No events to insert after mapping; exiting`);
    if (unmappedPlayers.size > 0) {
      console.warn(`${LOG_PREFIX} Unmapped players: ${Array.from(unmappedPlayers).join(', ')}`);
    }
    return {
      eventsInserted: 0,
      stubPlayersCreatedScorer: stubCreatedScorerCount,
      stubPlayersCreatedAssist: stubCreatedAssistCount,
      stubPlayersCreatedPenalty: stubCreatedPenaltyCount,
      unmappedAssistCount,
      unmappedScorers: unmappedPlayers.size,
      unmappedPenaltyPlayers,
      penaltiesInserted,
      misconductsDetected,
      redCardsDetected,
    };
  }

  const dedupedEvents = (() => {
    const byKey = new Map<string, typeof events[number]>();
    for (const ev of events) {
      const key = `${ev.match_id}|${ev.event_type}|${ev.period ?? ''}|${ev.time ?? ''}|${ev.player_id ?? ''}|${
        ev.assist_id ?? ''
      }|${ev.pen_min ?? 0}|${ev.reason ?? ''}`;
      if (!byKey.has(key)) {
        byKey.set(key, ev);
      }
    }
    return Array.from(byKey.values());
  })();

  console.log(
    `${LOG_PREFIX} events_before=${events.length} events_after=${dedupedEvents.length} removed=${events.length - dedupedEvents.length}`,
  );

  const dedupedGoalieStats = (() => {
    const byKey = new Map<string, InsertableGoalieStat>();
    for (const row of goalieStats) {
      const key = `${row.match_id}|${row.player_id}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, row);
        continue;
      }
      const existingMinutes = existing.minutes_seconds ?? -1;
      const currentMinutes = row.minutes_seconds ?? -1;
      if (currentMinutes >= existingMinutes) {
        byKey.set(key, row);
      }
    }
    return Array.from(byKey.values());
  })();

  console.log(
    `${LOG_PREFIX} goalie_rows_before=${goalieStats.length} goalie_rows_after=${dedupedGoalieStats.length} removed=${
      goalieStats.length - dedupedGoalieStats.length
    }`,
  );

  console.log(`${LOG_PREFIX} DB upsert match_events rows=${dedupedEvents.length}`);
  let inserted = 0;
  try {
    const { error: insertError, count } = await supa.client
      .from('match_events')
      .insert(dedupedEvents, { count: 'exact' });

    if (insertError) {
      throw insertError;
    }
    inserted = count ?? dedupedEvents.length;
  } catch (err) {
    console.error(`${LOG_PREFIX} DB FAILED match_events`, err);
    throw err;
  }

  console.log(`${LOG_PREFIX} DB upsert match_goalie_stats rows=${dedupedGoalieStats.length}`);
  try {
    goalieStatsInserted = await upsertMatchGoalieStats(supa.client, match.id, dedupedGoalieStats);
  } catch (err) {
    console.error(`${LOG_PREFIX} DB FAILED match_goalie_stats`, err);
    throw err;
  }

  console.log(`${LOG_PREFIX} Inserted events: ${inserted}`);
  console.log(`${LOG_PREFIX} Inserted goalie stat rows: ${goalieStatsInserted}`);
  if (match.id === GOALIE_LOG_MATCH_ID) {
    console.log(`${LOG_PREFIX} Goalie summary`, {
      parsed: parsedGoalieStats.length,
      upserted: goalieStatsInserted,
    });
  }
  if (unmappedPlayers.size > 0) {
    console.warn(`${LOG_PREFIX} Unmapped players: ${Array.from(unmappedPlayers).join(', ')}`);
  }

  return {
    eventsInserted: inserted,
    stubPlayersCreatedScorer: stubCreatedScorerCount,
    stubPlayersCreatedAssist: stubCreatedAssistCount,
    stubPlayersCreatedPenalty: stubCreatedPenaltyCount,
    unmappedAssistCount,
    unmappedScorers: unmappedPlayers.size,
    unmappedPenaltyPlayers,
    penaltiesInserted,
    misconductsDetected,
    redCardsDetected,
    goalieStatsInserted,
  };
}

async function main(): Promise<void> {
  const { matchId, allFinished } = parseArgs();
  const env = getEnv();
  const supa = createSupabase(env);

  if (allFinished) {
    const currentSeason = await fetchCurrentSeason(supa.client);
    console.log(`${LOG_PREFIX} Current season: ${currentSeason}`);
    const matches = await fetchFinishedMatches(supa.client, currentSeason);
    const totalConsidered = matches.length;
    console.log(`${LOG_PREFIX} Finished matches to ingest: ${totalConsidered}`);

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    let totalEventsInserted = 0;
    let totalStubPlayersScorer = 0;
    let totalStubPlayersAssist = 0;
    let totalStubPlayersPenalty = 0;
    let totalUnmappedAssists = 0;
    let totalUnmappedPenalties = 0;
    let totalPenaltiesInserted = 0;
    let totalMisconducts = 0;
    let totalRedCards = 0;
    let totalGoalieRows = 0;
    let matchesWithTwoGoalies = 0;
    const matchesWithZeroGoalies: string[] = [];

    for (let i = 0; i < matches.length; i += 1) {
      const match = matches[i];
      console.log(
        `${LOG_PREFIX} [${i + 1}/${totalConsidered}] matchId=${match.id} external_id=${match.external_id} date=${match.date ?? 'unknown'}`,
      );

      if (!match.external_id || match.external_id === '' || match.external_id.startsWith('vv:')) {
        console.warn(`${LOG_PREFIX} SKIP matchId=${match.id} reason=invalid_protocol_slug`);
        skipped += 1;
        continue;
      }

      try {
        const {
          eventsInserted,
          stubPlayersCreatedScorer,
          stubPlayersCreatedAssist,
          unmappedAssistCount,
          stubPlayersCreatedPenalty,
          unmappedPenaltyPlayers,
          penaltiesInserted,
          misconductsDetected,
          redCardsDetected,
          goalieStatsInserted,
        } = await ingestSingleMatch(
          supa,
          env,
          match,
        );
        succeeded += 1;
        totalEventsInserted += eventsInserted;
        totalStubPlayersScorer += stubPlayersCreatedScorer;
        totalStubPlayersAssist += stubPlayersCreatedAssist;
        totalUnmappedAssists += unmappedAssistCount;
        totalStubPlayersPenalty += stubPlayersCreatedPenalty;
        totalUnmappedPenalties += unmappedPenaltyPlayers;
        totalPenaltiesInserted += penaltiesInserted;
        totalMisconducts += misconductsDetected;
        totalRedCards += redCardsDetected;
        totalGoalieRows += goalieStatsInserted;
        if (goalieStatsInserted === 2) matchesWithTwoGoalies += 1;
        if (goalieStatsInserted === 0) matchesWithZeroGoalies.push(match.id);
      } catch (error) {
        failed += 1;
        const reason = (error as Error)?.message ?? 'unknown';
        console.error(`${LOG_PREFIX} MATCH_FAILED matchId=${match.id} reason=${reason}`, error);
      }
    }

    console.log(
      `${LOG_PREFIX} Batch summary: total_matches_considered=${totalConsidered}, succeeded=${succeeded}, failed=${failed}, skipped=${skipped}, events_inserted=${totalEventsInserted}, penalties_inserted=${totalPenaltiesInserted}, misconducts_detected=${totalMisconducts}, red_cards_detected=${totalRedCards}, stub_players_created_scorer=${totalStubPlayersScorer}, stub_players_created_assist=${totalStubPlayersAssist}, stub_players_created_penalty=${totalStubPlayersPenalty}, unmapped_assists=${totalUnmappedAssists}, unmapped_penalties=${totalUnmappedPenalties}`,
    );
    console.log(
      `${LOG_PREFIX} Goalie summary: total_goalie_rows=${totalGoalieRows}, matches_with_two_goalies=${matchesWithTwoGoalies}, matches_with_zero_goalies=${matchesWithZeroGoalies.length}`,
    );
    if (matchesWithZeroGoalies.length) {
      console.log(`${LOG_PREFIX} Matches missing goalie stats: ${matchesWithZeroGoalies.join(', ')}`);
    }
    return;
  }

  if (!matchId) {
    throw new Error('matchId is required in single-match mode');
  }

  const match = await fetchMatch(supa.client, matchId);
  const {
    eventsInserted,
    stubPlayersCreatedScorer,
    stubPlayersCreatedAssist,
    unmappedAssistCount,
    stubPlayersCreatedPenalty,
    unmappedPenaltyPlayers,
    penaltiesInserted,
    misconductsDetected,
    redCardsDetected,
  } = await ingestSingleMatch(supa, env, match);
  console.log(
    `${LOG_PREFIX} Summary: total_matches_considered=1, succeeded=1, failed=0, skipped=0, events_inserted=${eventsInserted}, penalties_inserted=${penaltiesInserted}, misconducts_detected=${misconductsDetected}, red_cards_detected=${redCardsDetected}, stub_players_created_scorer=${stubPlayersCreatedScorer}, stub_players_created_assist=${stubPlayersCreatedAssist}, stub_players_created_penalty=${stubPlayersCreatedPenalty}, unmapped_assists=${unmappedAssistCount}, unmapped_penalties=${unmappedPenaltyPlayers}`,
  );
}

main().catch((error) => {
  console.error(`${LOG_PREFIX} Failed`, error);
  process.exit(1);
});
