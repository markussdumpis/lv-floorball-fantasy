import type { CheerioAPI, Element } from 'cheerio';
import type { SupabaseClient } from '@supabase/supabase-js';
import { writeFile } from 'node:fs/promises';
import { getEnv } from './env.js';
import { fetchWithRetry } from './http.js';
import { cleanText, extractCleanName, loadHtml } from './html.js';
import { createSupabase } from './supa.js';

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
};

type PlayerRow = {
  id: string;
  name: string | null;
  team_id: string;
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

type InsertableEvent = {
  match_id: string;
  ts_seconds: number | null;
  period: number | null;
  team_id: string;
  player_id: string;
  assist_id: string | null;
  event_type: 'goal';
  value: null;
  raw: unknown;
  created_at: string;
};

const LOG_PREFIX = '[ingest:match-events]';

function normalizeWhitespace(value: string | null | undefined): string {
  return cleanText((value ?? '').replace(/\u00a0/g, ' ')).replace(/\s+/g, ' ').trim();
}

function stripJerseyNumber(value: string | null | undefined): string {
  const cleaned = normalizeWhitespace(value);
  return cleaned.replace(/#\d+\s*/g, '').trim();
}

function extractJerseyNumber(value: string | null | undefined): string | null {
  const match = (value ?? '').match(/#(\d{1,3})/);
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

function parseArgs(): { matchId: string } {
  const matchId = getArgValue('--matchId');
  if (!matchId) {
    console.error('Usage: npm run ingest:match-events -- --matchId <uuid>');
    process.exit(1);
  }
  console.log(`${LOG_PREFIX} matchId:`, matchId);
  return { matchId };
}

function buildProtocolUrl(externalId: string, season: string | null): string {
  const seasonPath = season ?? '2025';
  // Default league path is vv per requirements.
  return `https://www.floorball.lv/lv/${seasonPath}/chempionats/vv/proto/${externalId}`;
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

function parseGoalsFromHtml(html: string): { goals: ParsedGoal[]; rowsScanned: number } {
  const $ = loadHtml(html);
  const goals: ParsedGoal[] = [];
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
    if (!/^vārti/i.test(typeText)) {
      return;
    }

    const className = ($(cells[0]).attr('class') ?? '').toLowerCase();
    const teamSide = className.includes('maj') ? 'home' : className.includes('vie') ? 'away' : null;

    const timeText = cleanText($(cells[0]).text());
    const scoreText = cleanText($(cells[2]).text());
    const detailsText = cleanText($(cells[3]).text());

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

  return { goals, rowsScanned };
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
): Promise<TeamRow[]> {
  const { data, error } = await client.from('teams').select('id, name, code').in('id', ids);
  if (error) {
    throw error;
  }
  return (data ?? []) as TeamRow[];
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

async function ensureStubPlayer(
  client: SupabaseClient,
  teamId: string,
  canonicalName: string,
  normalizedName: string,
  playerIndex: Map<string, string>,
): Promise<string | null> {
  const existing = playerIndex.get(`${teamId}:${normalizedName}`);
  if (existing) {
    return existing;
  }

  const { data, error } = await client
    .from('players')
    .insert(
      {
        name: canonicalName,
        team_id: teamId,
        position: 'U',
      },
      { defaultToNull: false },
    )
    .select('id')
    .single();

  if (error || !data?.id) {
    console.warn(`${LOG_PREFIX} Failed to create stub player`, { error, canonicalName, teamId });
    return null;
  }

  playerIndex.set(`${teamId}:${normalizedName}`, data.id);
  console.log(`${LOG_PREFIX} CREATED_STUB_PLAYER`, {
    team_id: teamId,
    canonicalName,
    reason: 'protocol_unmapped',
  });
  return data.id;
}

async function main(): Promise<void> {
  const { matchId } = parseArgs();
  const env = getEnv();
  const supa = createSupabase(env);

  const match = await fetchMatch(supa.client, matchId);
  const protocolUrl = buildProtocolUrl(match.external_id, match.season);
  console.log(`${LOG_PREFIX} Protocol URL: ${protocolUrl}`);

  const { body: html, status, headers } = await fetchWithRetry(protocolUrl, {
    headers: {
      'user-agent': env.userAgent,
      cookie: env.cookie,
    },
  });
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

  const { goals: parsedGoals, rowsScanned } = parseGoalsFromHtml(html);
  console.log(`${LOG_PREFIX} Rows scanned: ${rowsScanned}`);
  console.log(`${LOG_PREFIX} Goals parsed: ${parsedGoals.length}`);

  const teams = await fetchTeams(supa.client, [match.home_team, match.away_team]);
  const players = await fetchPlayers(supa.client, [match.home_team, match.away_team]);
  const playerIndex = buildPlayerIndex(players);

  const unmappedPlayers = new Set<string>();
  let unmappedAssistCount = 0;
  let stubCreatedCount = 0;
  const events: InsertableEvent[] = [];

  for (const goal of parsedGoals) {
    const teamId = goal.teamSide === 'home' ? match.home_team : goal.teamSide === 'away' ? match.away_team : null;
    if (!teamId) {
      console.warn(`${LOG_PREFIX} Unable to resolve team for goal row`, goal.detailsText);
      continue;
    }

    let scorerId = mapPlayerId(goal.scorerNormalized, teamId, playerIndex);
    if (!scorerId) {
      const jersey = extractJerseyNumber(goal.scorerRaw);
      const cleanName = normalizeWhitespace(stripJerseyNumber(goal.scorerRaw));
      const canonicalName = cleanName ? (jersey ? `${cleanName} #${jersey}` : cleanName) : '';
      const normalizedCanonical = normalizeName(canonicalName);

      const candidates = Array.from(playerIndex.entries())
        .filter(([key]) => key.startsWith(`${teamId}:`))
        .map(([key]) => key.split(':')[1])
        .slice(0, 5);

      scorerId =
        canonicalName && normalizedCanonical
          ? await ensureStubPlayer(supa.client, teamId, canonicalName, normalizedCanonical, playerIndex)
          : null;

      if (scorerId) {
        stubCreatedCount += 1;
      } else {
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
    }

    let assistId: string | null = null;
    if (goal.assistNormalized) {
      assistId = mapPlayerId(goal.assistNormalized, teamId, playerIndex);
      if (!assistId) {
        unmappedAssistCount += 1;
        const candidates = Array.from(playerIndex.entries())
          .filter(([key]) => key.startsWith(`${teamId}:`))
          .map(([key]) => key.split(':')[1])
          .slice(0, 5);
        console.warn(`${LOG_PREFIX} UNMAPPED_ASSIST`, {
          team_id: teamId,
          raw: goal.assistRaw,
          normalized: goal.assistNormalized,
          raw_row: goal.detailsText,
          candidates,
        });
      }
    }

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
      },
      created_at: new Date().toISOString(),
    });
  }

  console.log(`${LOG_PREFIX} Goals mapped to events: ${events.length}`);
  console.log(
    `${LOG_PREFIX} Summary: rows_scanned=${rowsScanned}, goals_detected=${parsedGoals.length}, goals_insertable=${events.length}, unmapped_scorers=${unmappedPlayers.size}, unmapped_assists=${unmappedAssistCount}, stub_players_created=${stubCreatedCount}`,
  );

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
    return;
  }

  const { error: insertError, count } = await supa.client
    .from('match_events')
    .insert(events, { count: 'exact' });

  if (insertError) {
    throw insertError;
  }

  console.log(`${LOG_PREFIX} Inserted events: ${count ?? events.length}`);
  if (unmappedPlayers.size > 0) {
    console.warn(`${LOG_PREFIX} Unmapped players: ${Array.from(unmappedPlayers).join(', ')}`);
  }
}

main().catch((error) => {
  console.error(`${LOG_PREFIX} Failed`, error);
  process.exit(1);
});
