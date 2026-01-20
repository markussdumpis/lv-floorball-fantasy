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

type InsertableEvent = {
  match_id: string;
  ts_seconds: number | null;
  period: number | null;
  team_id: string;
  player_id: string;
  assist_id: string | null;
  event_type: 'goal' | 'minor_2' | 'double_minor' | 'misconduct_10' | 'red_card';
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

async function ensureStubPlayer(
  client: SupabaseClient,
  teamId: string,
  canonicalName: string,
  normalizedName: string,
  playerIndex: Map<string, string>,
  logLabel:
    | 'CREATED_STUB_PLAYER'
    | 'CREATED_STUB_PLAYER_ASSIST'
    | 'CREATED_STUB_PLAYER_PENALTY' = 'CREATED_STUB_PLAYER',
  reason: 'protocol_unmapped' | 'protocol_unmapped_assist' | 'protocol_unmapped_penalty' = 'protocol_unmapped',
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
  console.log(`${LOG_PREFIX} ${logLabel}`, {
    team_id: teamId,
    canonicalName,
    reason,
  });
  return data.id;
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
}> {
  if (!match.external_id || match.external_id === '' || match.external_id.startsWith('vv:')) {
    throw new Error('Match missing valid protocol slug');
  }

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

  const { goals: parsedGoals, penalties: parsedPenalties, rowsScanned } = parseGoalsFromHtml(html);
  console.log(`${LOG_PREFIX} Rows scanned: ${rowsScanned}`);
  console.log(`${LOG_PREFIX} Goals parsed: ${parsedGoals.length}`);
  console.log(`${LOG_PREFIX} Penalties parsed: ${parsedPenalties.length}`);

  const teams = await fetchTeams(supa.client, [match.home_team, match.away_team]);
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
        stubCreatedScorerCount += 1;
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
        const jersey = extractJerseyNumber(goal.assistRaw);
        const cleanName = normalizeWhitespace(stripJerseyNumber(goal.assistRaw));
        const canonicalName = cleanName ? (jersey ? `${cleanName} #${jersey}` : cleanName) : '';
        const normalizedCanonical = normalizeName(canonicalName);

        const candidates = Array.from(playerIndex.entries())
          .filter(([key]) => key.startsWith(`${teamId}:`))
          .map(([key]) => key.split(':')[1])
          .slice(0, 5);

        if (canonicalName && normalizedCanonical) {
          assistId = await ensureStubPlayer(
            supa.client,
            teamId,
            canonicalName,
            normalizedCanonical,
            playerIndex,
            'CREATED_STUB_PLAYER_ASSIST',
            'protocol_unmapped_assist',
          );
          if (assistId) {
            stubCreatedAssistCount += 1;
          }
        }

        if (!assistId) {
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
      const jersey = extractJerseyNumber(pen.playerPart);
      const cleanName = normalizeWhitespace(stripJerseyNumber(pen.playerPart));
      const canonicalName = cleanName ? (jersey ? `${cleanName} #${jersey}` : cleanName) : '';
      const normalizedCanonical = normalizeName(canonicalName);

      const candidates = Array.from(playerIndex.entries())
        .filter(([key]) => key.startsWith(`${teamId}:`))
        .map(([key]) => key.split(':')[1])
        .slice(0, 5);

      playerId =
        canonicalName && normalizedCanonical
          ? await ensureStubPlayer(
              supa.client,
              teamId,
              canonicalName,
              normalizedCanonical,
              playerIndex,
              'CREATED_STUB_PLAYER_PENALTY',
              'protocol_unmapped_penalty',
            )
          : null;

      if (playerId) {
        stubCreatedPenaltyCount += 1;
      } else {
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

  const { error: insertError, count } = await supa.client
    .from('match_events')
    .insert(events, { count: 'exact' });

  if (insertError) {
    throw insertError;
  }

  const inserted = count ?? events.length;

  console.log(`${LOG_PREFIX} Inserted events: ${inserted}`);
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
      } catch (error) {
        failed += 1;
        const reason = (error as Error)?.message ?? 'unknown';
        console.error(`${LOG_PREFIX} MATCH_FAILED matchId=${match.id} reason=${reason}`, error);
      }
    }

    console.log(
      `${LOG_PREFIX} Batch summary: total_matches_considered=${totalConsidered}, succeeded=${succeeded}, failed=${failed}, skipped=${skipped}, events_inserted=${totalEventsInserted}, penalties_inserted=${totalPenaltiesInserted}, misconducts_detected=${totalMisconducts}, red_cards_detected=${totalRedCards}, stub_players_created_scorer=${totalStubPlayersScorer}, stub_players_created_assist=${totalStubPlayersAssist}, stub_players_created_penalty=${totalStubPlayersPenalty}, unmapped_assists=${totalUnmappedAssists}, unmapped_penalties=${totalUnmappedPenalties}`,
    );
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
