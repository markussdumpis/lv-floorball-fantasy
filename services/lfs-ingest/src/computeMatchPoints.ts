import { pathToFileURL } from 'node:url';
import { getEnv } from './env.js';
import { createSupabase } from './supa.js';

type EventType =
  | 'goal'
  | 'assist'
  | 'hat_trick'
  | 'penalty_shot_scored'
  | 'penalty_shot_missed'
  | 'minor_2'
  | 'double_minor'
  | 'misconduct_10'
  | 'red_card'
  | 'mvp'
  | 'save'
  | 'goal_allowed'
  | string;

type MatchEventRow = {
  id: string;
  match_id: string;
  player_id: string;
  event_type: EventType;
  value?: number | null;
  ts_seconds?: number | null;
  period?: number | null;
  team_id?: string | null;
  assist_id?: string | null;
};

type PlayerMeta = {
  id: string;
  name?: string | null;
  position?: string | null;
};

type PlayerMatchPointsRow = {
  match_id: string;
  player_id: string;
  team_id: string | null;
  position: string;
  goals: number;
  assists: number;
  shots_on_goal: number;
  pen_min: number;
  saves: number;
  goals_against: number;
  hat_trick: boolean;
  game_winner: boolean;
  clean_sheet: boolean;
  fantasy_points: number;
  fantasy_points_base: number;
  fantasy_points_bonus: number;
};

type MatchRow = {
  id: string;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  date?: string | null;
};

function usage(): never {
  console.error('Usage: npm run compute:match-points -- <match_id> | --all-finished');
  process.exit(1);
}

function parseArgs(): { matchId: string | null; allFinished: boolean } {
  const args = process.argv.slice(2);
  const allFinished = args.includes('--all-finished');
  const matchId = args.find((arg) => !arg.startsWith('--')) ?? null;

  if ((matchId && allFinished) || (!matchId && !allFinished)) {
    usage();
  }

  return { matchId, allFinished };
}

function groupByPlayer(events: MatchEventRow[]): Map<string, MatchEventRow[]> {
  const grouped = new Map<string, MatchEventRow[]>();
  events.forEach((event) => {
    const key = event.player_id;
    if (!key) return;
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(event);
    } else {
      grouped.set(key, [event]);
    }
  });
  return grouped;
}

function aggregatePlayerEvents(
  match: MatchRow,
  playerId: string,
  events: MatchEventRow[],
  playerMeta?: PlayerMeta,
  teamId?: string,
  assistsOverride: number = 0,
): PlayerMatchPointsRow {
  const normalizedPosition = ((playerMeta?.position as string | undefined)?.toUpperCase() ?? '').trim();
  const position = normalizedPosition || 'U';

  const isGoalie = position === 'V';
  const isDefender = position === 'A';

  let goals = 0;
  let assists = 0;
  let penMin = 0;
  let saves = 0;
  let redCards = 0;
  let misconduct10 = 0;
  let penaltyShotScored = 0;
  let penaltyShotMissed = 0;
  let doubleMinorCount = 0;
  let minorCount = 0;

  for (const ev of events) {
    if (ev.event_type === 'goal') goals += 1;
    if (ev.event_type === 'save') saves += 1;
    if (ev.event_type === 'minor_2') {
      penMin += 2;
      minorCount += 1;
    }
    if (ev.event_type === 'double_minor') {
      penMin += 4;
      doubleMinorCount += 1;
    }
    if (ev.event_type === 'red_card') redCards += 1;
    if (ev.event_type === 'misconduct_10') misconduct10 += 1;
    if (ev.event_type === 'penalty_shot_scored') penaltyShotScored += 1;
    if (ev.event_type === 'penalty_shot_missed') penaltyShotMissed += 1;
  }

  const homeScore = Number.isFinite(match.home_score) ? (match.home_score as number) : Number(match.home_score ?? 0);
  const awayScore = Number.isFinite(match.away_score) ? (match.away_score as number) : Number(match.away_score ?? 0);

  const goalWeight = isGoalie ? 0 : isDefender ? 2 : 1.5;
  const assistWeight = isGoalie ? 0 : isDefender ? 1.5 : 1.0;

  const goalPoints = goals * goalWeight;
  const totalAssists = assists + assistsOverride;
  const assistPoints = totalAssists * assistWeight;
  const penaltyShotPoints = isGoalie ? 0 : penaltyShotScored * 0.5 + penaltyShotMissed * -0.5;
  const penaltyPoints = isGoalie ? 0 : minorCount * -0.5 + doubleMinorCount * -2;
  const misconductPoints = isGoalie ? 0 : misconduct10 * -3;
  const redCardPoints = isGoalie ? 0 : redCards * -6;
  const savePoints = isGoalie ? saves * 0.1 : 0;

  let goalsAgainst = 0;
  if (isGoalie && teamId) {
    const isHome = teamId === match.home_team;
    const opponentScore = isHome ? awayScore : homeScore;
    goalsAgainst = opponentScore ?? 0;
  }

  let gaBandPoints = 0;
  if (isGoalie) {
    if (goalsAgainst === 0) gaBandPoints = 8;
    else if (goalsAgainst <= 2) gaBandPoints = 5;
    else if (goalsAgainst <= 5) gaBandPoints = 2;
    else if (goalsAgainst <= 9) gaBandPoints = -2;
    else gaBandPoints = -5;
  }

  const hatTrick = !isGoalie && goals >= 3;
  const winBonus = (() => {
    if (!isGoalie || !teamId) return 0;
    const isHome = teamId === match.home_team;
    const forScore = isHome ? homeScore : awayScore;
    const againstScore = isHome ? awayScore : homeScore;
    return forScore > againstScore ? 2 : 0;
  })();

  const cleanSheet = isGoalie && goalsAgainst === 0;

  const fantasy_points_base =
    goalPoints +
    assistPoints +
    penaltyShotPoints +
    penaltyPoints +
    misconductPoints +
    redCardPoints +
    savePoints +
    gaBandPoints;

  const fantasy_points_bonus = (hatTrick ? 3 : 0) + winBonus + (cleanSheet ? 0 : 0);
  const fantasy_points = fantasy_points_base + fantasy_points_bonus;

  return {
    match_id: match.id,
    player_id: playerId,
    team_id: teamId ?? null,
    position,
    goals,
    assists: totalAssists,
    shots_on_goal: 0,
    pen_min: penMin,
    saves,
    goals_against: goalsAgainst,
    hat_trick: hatTrick,
    game_winner: false,
    clean_sheet: cleanSheet,
    fantasy_points,
    fantasy_points_base,
    fantasy_points_bonus,
  };
}

async function fetchPlayerMeta(
  supabase: ReturnType<typeof createSupabase>['client'],
  playerIds: string[],
): Promise<Map<string, PlayerMeta>> {
  if (!playerIds.length) {
    return new Map();
  }

  const { data, error } = await supabase
    .from('players')
    .select('id, position, name')
    .in('id', playerIds);

  if (error) {
    console.warn('[points] Failed to load player metadata; proceeding without positions.', error);
    return new Map();
  }

  const map = new Map<string, PlayerMeta>();
  for (const row of data ?? []) {
    if (row?.id) {
      map.set(row.id, { id: row.id, position: (row as PlayerMeta).position, name: (row as PlayerMeta).name });
    }
  }
  return map;
}

async function loadMatchEvents(
  supabase: ReturnType<typeof createSupabase>['client'],
  matchId: string,
): Promise<MatchEventRow[]> {
  console.log(`[points] Computing match points for match ${matchId}...`);

  const { data: events, error } = await supabase
    .from('match_events')
    .select('id, match_id, player_id, assist_id, event_type, value, ts_seconds, period, team_id')
    .eq('match_id', matchId);

  if (error) {
    throw error;
  }

  const rows = events ?? [];
  console.log(`[points] Loaded ${rows.length} events for match ${matchId}`);
  return rows;
}

async function deleteExistingPoints(
  supabase: ReturnType<typeof createSupabase>['client'],
  matchId: string,
): Promise<void> {
  const { error } = await supabase.from('player_match_points').delete().eq('match_id', matchId);
  if (error) {
    throw error;
  }
}

async function insertPoints(
  supabase: ReturnType<typeof createSupabase>['client'],
  rows: PlayerMatchPointsRow[],
): Promise<number> {
  if (!rows.length) return 0;
  const { error, count } = await supabase.from('player_match_points').insert(rows, { count: 'exact' });
  if (error) {
    throw error;
  }
  return count ?? rows.length;
}

async function fetchMatch(
  supabase: ReturnType<typeof createSupabase>['client'],
  matchId: string,
): Promise<MatchRow> {
  const { data, error } = await supabase
    .from('matches')
    .select('id, home_team, away_team, home_score, away_score')
    .eq('id', matchId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error(`Match ${matchId} not found`);
  }

  return data as MatchRow;
}

async function computeForMatch(
  supabase: ReturnType<typeof createSupabase>['client'],
  matchId: string,
): Promise<{ inserted: number; totalPoints: number; skippedNoTeam: number }> {
  const match = await fetchMatch(supabase, matchId);
  const events = await loadMatchEvents(supabase, matchId);

  if (!events.length) {
    return { inserted: 0, totalPoints: 0, skippedNoTeam: 0 };
  }

  await deleteExistingPoints(supabase, matchId);

  const grouped = groupByPlayer(events);
  const scorerIds = new Set(Array.from(grouped.keys()));
  const assistCounts = new Map<string, number>();
  let sumAssistsFromEvents = 0;
  events.forEach((ev) => {
    if (ev.event_type === 'goal' && ev.assist_id) {
      assistCounts.set(ev.assist_id, (assistCounts.get(ev.assist_id) ?? 0) + 1);
      sumAssistsFromEvents += 1;
    }
  });
  const assisterIds = new Set(Array.from(assistCounts.keys()));
  const sumAssistsComputed = Array.from(assistCounts.values()).reduce((a, b) => a + b, 0);
  const playerIds = new Set<string>();
  scorerIds.forEach((id) => playerIds.add(id));
  assisterIds.forEach((id) => playerIds.add(id));

  console.log('[points] Player sets', {
    unique_scorers: scorerIds.size,
    unique_assisters: assisterIds.size,
    total_players: playerIds.size,
    sumAssistsFromEvents,
    sumAssistsComputed,
  });

  const playerMeta = await fetchPlayerMeta(supabase, Array.from(playerIds));

  const rows: PlayerMatchPointsRow[] = [];
  let skippedNoTeam = 0;

  // For assist-only players, derive team_id from the scoring event they assisted.
  const teamByAssistOnly = new Map<string, string | null>();
  events.forEach((ev) => {
    if (ev.event_type === 'goal' && ev.assist_id && ev.team_id) {
      if (!teamByAssistOnly.has(ev.assist_id)) {
        teamByAssistOnly.set(ev.assist_id, ev.team_id);
      }
    }
  });

  for (const playerId of playerIds) {
    const playerEvents = grouped.get(playerId) ?? [];
    const teamIds = Array.from(new Set(playerEvents.map((ev) => ev.team_id).filter((v): v is string => Boolean(v))));

    let teamId: string | null = null;
    if (teamIds.length === 1) {
      teamId = teamIds[0];
    } else if (teamIds.length > 1) {
      teamId = teamIds[0];
      console.warn('[points] TEAM_ID_MISMATCH', { match_id: matchId, player_id: playerId, teamIds });
    } else if (!teamId) {
      teamId = teamByAssistOnly.get(playerId) ?? null;
    }

    if (!teamId) {
      skippedNoTeam += 1;
      console.warn('[points] SKIP_PLAYER_NO_TEAM_ID', { match_id: matchId, player_id: playerId });
      continue;
    }

    rows.push(
      aggregatePlayerEvents(
        match,
        playerId,
        playerEvents,
        playerMeta.get(playerId),
        teamId,
        assistCounts.get(playerId) ?? 0,
      ),
    );
  }

  if (!rows.length) {
    console.warn('[points] No player rows were aggregated.');
    return { inserted: 0, totalPoints: 0, skippedNoTeam };
  }

  rows.forEach((row) => {
    ['fantasy_points_base', 'fantasy_points_bonus', 'fantasy_points'].forEach((key) => {
      const val = (row as any)[key];
      if (!Number.isFinite(val)) {
        console.warn('[points] NaN detected', { match_id: matchId, player_id: row.player_id, key, val });
        (row as any)[key] = 0;
      }
    });
    row.fantasy_points = (row.fantasy_points_base ?? 0) + (row.fantasy_points_bonus ?? 0);
  });

  const positionTotals = rows.reduce(
    (acc, row) => {
      const key = row.position === 'V' ? 'V' : row.position === 'A' ? 'A' : 'U';
      acc[key].goals += row.goals;
      acc[key].assists += row.assists;
      acc[key].pen_min += row.pen_min;
      acc[key].saves += row.saves;
      acc[key].goals_against += row.goals_against;
      return acc;
    },
    {
      U: { goals: 0, assists: 0, pen_min: 0, saves: 0, goals_against: 0 },
      A: { goals: 0, assists: 0, pen_min: 0, saves: 0, goals_against: 0 },
      V: { goals: 0, assists: 0, pen_min: 0, saves: 0, goals_against: 0 },
    },
  );

  const playerMetaById = playerMeta;
  if (matchId === 'bb4bc04f-56a7-4a48-b7b6-0dfab7286b88') {
    const ragovskisRow = rows.find((r) => (playerMetaById.get(r.player_id)?.name ?? '').toLowerCase().includes('ragovskis'));
    if (ragovskisRow) {
      console.log('[points] Ragovskis row', {
        player_id: ragovskisRow.player_id,
        goals: ragovskisRow.goals,
        assists: ragovskisRow.assists,
        fantasy_points: ragovskisRow.fantasy_points,
      });
    }
  }

  const inserted = await insertPoints(supabase, rows);
  const totalPoints = rows.reduce((sum, row) => sum + row.fantasy_points, 0);

  console.log('[points] Position totals', positionTotals);
  console.log(
    '[points] Points sample',
    rows.slice(0, 5).map((r) => ({
      player_id: r.player_id,
      position: r.position,
      goals: r.goals,
      assists: r.assists,
      pen_min: r.pen_min,
      saves: r.saves,
      goals_against: r.goals_against,
      fantasy_points_base: r.fantasy_points_base,
      fantasy_points_bonus: r.fantasy_points_bonus,
      fantasy_points: r.fantasy_points,
    })),
  );
  const topAssists = [...rows]
    .sort((a, b) => (b.assists ?? 0) - (a.assists ?? 0))
    .slice(0, 10)
    .map((r) => ({ player_id: r.player_id, assists: r.assists, fantasy_points: r.fantasy_points }));
  console.log('[points] Top assists sample', topAssists);

  console.log(`[points] MATCH_SUMMARY`, {
    match_id: matchId,
    players_scored: rows.length,
    total_points: totalPoints,
    skipped_no_team_id: skippedNoTeam,
  });

  return { inserted, totalPoints, skippedNoTeam };
}

async function fetchFinishedMatches(
  supabase: ReturnType<typeof createSupabase>['client'],
): Promise<string[]> {
  const { data, error } = await supabase
    .from('matches')
    .select('id')
    .eq('status', 'finished')
    .order('date', { ascending: true })
    .order('id', { ascending: true });
  if (error) {
    throw error;
  }
  return (data ?? []).map((row) => (row as { id: string }).id);
}

async function countEventsForMatch(
  supabase: ReturnType<typeof createSupabase>['client'],
  matchId: string,
): Promise<number> {
  const { count, error } = await supabase.from('match_events').select('id', { count: 'exact', head: true }).eq('match_id', matchId);
  if (error) {
    throw error;
  }
  return count ?? 0;
}

async function main() {
  const { matchId, allFinished } = parseArgs();
  const env = getEnv();
  const supabase = createSupabase(env).client;
  console.log('[points] Using match_events.ts_seconds (minute column not present)');
  console.log('[points] player_match_points.team_id derived from match_events.team_id');
  const sanityPoints = 2 * 1.5 + -0.5;
  console.log('[points] Sanity: goals=2 assists=0 pen_min=2 position=U => expected fantasy_points 2.5', {
    computed: sanityPoints,
  });

  if (matchId) {
    const eventCount = await countEventsForMatch(supabase, matchId);
    console.log(`[points] Match ${matchId} events_count=${eventCount}`);
    if (eventCount === 0) {
      console.warn(`[points] SKIPPED_NO_EVENTS match_id=${matchId}`);
      return;
    }
    const { inserted, totalPoints, skippedNoTeam } = await computeForMatch(supabase, matchId);
    console.log(
      `[points] Summary: total_matches=1, player_rows_inserted=${inserted}, total_points_sum=${totalPoints}, skipped_no_team_id=${skippedNoTeam}`,
    );
    return;
  }

  const matches = await fetchFinishedMatches(supabase);
  console.log(`[points] all-finished mode: total_finished=${matches.length}`);

  let totalInserted = 0;
  let totalPointsSum = 0;
  let totalSkippedNoTeam = 0;
  let processed = 0;
  let skippedNoEvents = 0;
  let skippedErrors = 0;

  for (let i = 0; i < matches.length; i += 1) {
    const id = matches[i];
    console.log(`[points] Processing match ${i + 1}/${matches.length}: ${id}`);
    try {
      const eventCount = await countEventsForMatch(supabase, id);
      if (eventCount === 0) {
        skippedNoEvents += 1;
        console.warn(`[points] SKIPPED_NO_EVENTS match_id=${id}`);
        continue;
      }
      const { inserted, totalPoints, skippedNoTeam } = await computeForMatch(supabase, id);
      totalInserted += inserted;
      totalPointsSum += totalPoints;
      totalSkippedNoTeam += skippedNoTeam;
      processed += 1;
    } catch (error) {
      console.error(`[points] MATCH_FAILED match_id=${id}`, error);
      skippedErrors += 1;
    }
  }

  console.log(
    `[points] Batch summary: total_finished=${matches.length}, processed=${processed}, skipped_no_events=${skippedNoEvents}, skipped_errors=${skippedErrors}, player_rows_inserted=${totalInserted}, total_points_sum=${totalPointsSum}, skipped_no_team_id=${totalSkippedNoTeam}`,
  );
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error) => {
    console.error('[points] Fatal error', error);
    process.exitCode = 1;
  });
}
