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
  minute?: number | null;
};

type PlayerMeta = {
  id: string;
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

function usage(): never {
  console.error('Usage: npm run compute:match-points -- <match_id>');
  process.exit(1);
}

async function loadMatchEvents(matchId: string) {
  const env = getEnv();
  const supabase = createSupabase(env).client;

  console.log(`[points] Computing match points for match ${matchId}...`);

  const { data: events, error } = await supabase
    .from('match_events')
    .select('id, match_id, player_id, event_type, value, minute')
    .eq('match_id', matchId);

  if (error) {
    throw error;
  }

  return { supabase, events: events ?? [] };
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
  matchId: string,
  playerId: string,
  events: MatchEventRow[],
  playerMeta?: PlayerMeta,
): PlayerMatchPointsRow {
  let goals = 0;
  let assists = 0;
  let penMin = 0;

  for (const ev of events) {
    if (ev.event_type === 'goal') goals += 1;
    if (ev.event_type === 'assist') assists += 1;
    if (ev.event_type === 'minor_2') penMin += 2;
    if (ev.event_type === 'double_minor') penMin += 4;
    if (typeof ev.value === 'number' && ev.event_type?.includes('pen')) {
      penMin += ev.value;
    }
  }

  const hatTrick = goals >= 3;
  const gameWinner = false; // TODO: implement game-winning goal detection
  const cleanSheet = false; // TODO: implement clean sheet detection

  const fantasy_points_base = goals * 5 + assists * 3;
  const fantasy_points_bonus = hatTrick ? 3 : 0;
  const fantasy_points = fantasy_points_base + fantasy_points_bonus;

  return {
    match_id: matchId,
    player_id: playerId,
    team_id: null, // TODO: derive from players or match metadata
    position: (playerMeta?.position as string) ?? 'A',
    goals,
    assists,
    shots_on_goal: 0,
    pen_min: penMin,
    saves: 0,
    goals_against: 0,
    hat_trick: hatTrick,
    game_winner: gameWinner,
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
    .select('id, position')
    .in('id', playerIds);

  if (error) {
    console.warn('[points] Failed to load player metadata; proceeding without positions.', error);
    return new Map();
  }

  const map = new Map<string, PlayerMeta>();
  for (const row of data ?? []) {
    if (row?.id) {
      map.set(row.id, { id: row.id, position: (row as PlayerMeta).position });
    }
  }
  return map;
}

async function main() {
  const matchId = process.argv[2];
  if (!matchId) {
    usage();
  }

  const { supabase, events } = await loadMatchEvents(matchId);

  if (!events.length) {
    console.warn('[points] No events found for match; nothing to compute.');
    return;
  }

  const grouped = groupByPlayer(events);
  const playerIds = Array.from(grouped.keys());
  const playerMeta = await fetchPlayerMeta(supabase, playerIds);

  const rows: PlayerMatchPointsRow[] = playerIds.map((playerId) =>
    aggregatePlayerEvents(matchId, playerId, grouped.get(playerId) ?? [], playerMeta.get(playerId)),
  );

  if (!rows.length) {
    console.warn('[points] No player rows were aggregated.');
    return;
  }

  const sample = rows.slice(0, 3).map((row) => ({
    player_id: row.player_id,
    goals: row.goals,
    assists: row.assists,
    fantasy_points: row.fantasy_points,
  }));

  console.log(
    `[points] Prepared ${rows.length} player rows for player_match_points (not inserted yet).`,
  );
  console.table(sample);

  // TODO: enable this once aggregation logic is finalized.
  // const { error: upsertError } = await supabase
  //   .from('player_match_points')
  //   .upsert(rows, { onConflict: 'match_id,player_id' });
  // if (upsertError) {
  //   console.error('[points] Failed to upsert player_match_points', upsertError);
  // }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error) => {
    console.error('[points] Fatal error', error);
    process.exitCode = 1;
  });
}
