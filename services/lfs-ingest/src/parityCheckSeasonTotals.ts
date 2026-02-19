import { pathToFileURL } from 'node:url';
import { getEnv } from './env.js';
import { createSupabase } from './supa.js';

type TotalsRow = {
  season: string;
  player_id: string;
  goals: number;
  assists: number;
  pen_min: number;
};

type TeamRow = {
  id: string;
  name?: string | null;
  code?: string | null;
  short_name?: string | null;
};

type PlayerRow = {
  id: string;
  name?: string | null;
  team_id: string;
};

type MismatchRow = {
  season: string;
  player_id: string;
  staging_goals: number;
  computed_goals: number;
  diff_goals: number;
  staging_assists: number;
  computed_assists: number;
  diff_assists: number;
  staging_pen_min: number;
  computed_pen_min: number;
  diff_pen_min: number;
  abs_score: number;
};

const LOG_PREFIX = '[parity:season-totals]';

function getArgValue(flag: string): string | null {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === flag && args[i + 1]) return args[i + 1];
    if (arg.startsWith(`${flag}=`)) return arg.split('=')[1] ?? null;
  }
  return null;
}

function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function printParityWarnBanner(): void {
  console.warn('========================================');
  console.warn('PARITY_WARN: staging vs computed mismatch');
  console.warn('========================================');
}

async function resolveLatestSeason(client: ReturnType<typeof createSupabase>['client']): Promise<string | null> {
  const { data, error } = await client
    .from('player_season_points_view')
    .select('season')
    .not('season', 'is', null)
    .order('season', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(`${LOG_PREFIX} Failed to resolve latest season from player_season_points_view`, error);
    return null;
  }
  const season = (data as { season?: string | null } | null)?.season ?? null;
  return season;
}

async function detectPenMinColumn(
  client: ReturnType<typeof createSupabase>['client'],
  tableOrView: 'players_stats_staging' | 'player_season_points_view',
): Promise<'pen_min' | 'penalty_min' | null> {
  const { data, error } = await client.from(tableOrView).select('*').limit(1);
  if (error) {
    throw error;
  }
  const sample = (data ?? [])[0] as Record<string, unknown> | undefined;
  const cols = new Set(Object.keys(sample ?? {}));
  if (cols.has('pen_min')) return 'pen_min';
  if (cols.has('penalty_min')) return 'penalty_min';
  if (tableOrView === 'players_stats_staging') return 'penalty_min';
  if (tableOrView === 'player_season_points_view') return 'pen_min';
  return null;
}

async function fetchComputedRows(
  client: ReturnType<typeof createSupabase>['client'],
  season: string,
): Promise<TotalsRow[]> {
  const computedPenMinCol = await detectPenMinColumn(client, 'player_season_points_view');
  if (!computedPenMinCol) {
    throw new Error('player_season_points_view missing pen_min/penalty_min');
  }
  const selectCols =
    computedPenMinCol === 'pen_min'
      ? 'player_id, season, goals, assists, pen_min'
      : 'player_id, season, goals, assists, pen_min:penalty_min';

  const { data, error } = await client
    .from('player_season_points_view')
    .select(selectCols)
    .eq('season', season);
  if (error) {
    throw error;
  }

  return (data ?? []).map((row: any) => ({
    season: String(row.season ?? season),
    player_id: String(row.player_id),
    goals: toNumber(row.goals),
    assists: toNumber(row.assists),
    pen_min: toNumber(row.pen_min),
  }));
}

async function fetchStagingRows(
  client: ReturnType<typeof createSupabase>['client'],
  season: string,
): Promise<TotalsRow[]> {
  const stagingPenMinCol = await detectPenMinColumn(client, 'players_stats_staging');
  if (!stagingPenMinCol) {
    throw new Error('players_stats_staging missing pen_min/penalty_min');
  }

  const sampleResp = await client.from('players_stats_staging').select('*').limit(1);
  if (sampleResp.error) {
    throw sampleResp.error;
  }
  const sample = (sampleResp.data ?? [])[0] as Record<string, unknown> | undefined;
  const cols = new Set(Object.keys(sample ?? {}));

  const selectCols = [
    'name',
    'team',
    'goals',
    'assists',
    cols.has('player_id') ? 'player_id' : null,
    cols.has('season') ? 'season' : null,
    stagingPenMinCol === 'pen_min' ? 'pen_min' : 'pen_min:penalty_min',
  ]
    .filter(Boolean)
    .join(', ');

  let q = client.from('players_stats_staging').select(selectCols);
  if (cols.has('season')) {
    q = q.eq('season', season);
  } else {
    console.warn(`${LOG_PREFIX} players_stats_staging has no season; using current staging snapshot for season ${season}`);
  }
  const { data, error } = await q;
  if (error) {
    throw error;
  }

  const rows = (data ?? []) as any[];
  if (cols.has('player_id')) {
    return rows.map((row) => ({
      season: String(row.season ?? season),
      player_id: String(row.player_id),
      goals: toNumber(row.goals),
      assists: toNumber(row.assists),
      pen_min: toNumber(row.pen_min),
    }));
  }

  const { data: teamSample, error: teamSampleError } = await client.from('teams').select('*').limit(1);
  if (teamSampleError) throw teamSampleError;
  const sampleTeam = (teamSample ?? [])[0] as Record<string, unknown> | undefined;
  const teamSelect = sampleTeam && Object.prototype.hasOwnProperty.call(sampleTeam, 'short_name') ? 'id, name, code, short_name' : 'id, name, code';

  const [{ data: teams, error: teamsError }, { data: players, error: playersError }] = await Promise.all([
    client.from('teams').select(teamSelect),
    client.from('players').select('id, name, team_id'),
  ]);
  if (teamsError) throw teamsError;
  if (playersError) throw playersError;

  const teamsList = (teams ?? []) as TeamRow[];
  const playersList = (players ?? []) as PlayerRow[];

  const teamIdByKey = new Map<string, string>();
  teamsList.forEach((team) => {
    [team.name, team.code, team.short_name].forEach((value) => {
      const key = normalizeText(value);
      if (key) teamIdByKey.set(key, team.id);
    });
  });

  const teamIdByContains = (teamNameRaw: string | null | undefined): string | null => {
    const normalized = normalizeText(teamNameRaw);
    if (!normalized) return null;
    const exact = teamIdByKey.get(normalized);
    if (exact) return exact;
    for (const [key, id] of teamIdByKey.entries()) {
      if (normalized.includes(key) || key.includes(normalized)) return id;
    }
    return null;
  };

  const playerIdByTeamAndName = new Map<string, string>();
  playersList.forEach((player) => {
    const key = `${player.team_id}:${normalizeText(player.name)}`;
    playerIdByTeamAndName.set(key, player.id);
  });

  let unmappedTeam = 0;
  let unmappedPlayer = 0;
  const mapped: TotalsRow[] = [];
  rows.forEach((row) => {
    const teamId = teamIdByContains(row.team);
    if (!teamId) {
      unmappedTeam += 1;
      return;
    }
    const playerId = playerIdByTeamAndName.get(`${teamId}:${normalizeText(row.name)}`);
    if (!playerId) {
      unmappedPlayer += 1;
      return;
    }
    mapped.push({
      season,
      player_id: playerId,
      goals: toNumber(row.goals),
      assists: toNumber(row.assists),
      pen_min: toNumber(row.pen_min),
    });
  });

  if (unmappedTeam > 0 || unmappedPlayer > 0) {
    console.warn(`${LOG_PREFIX} staging->player_id mapping gaps`, {
      unmapped_team_rows: unmappedTeam,
      unmapped_player_rows: unmappedPlayer,
      mapped_rows: mapped.length,
      staging_rows: rows.length,
    });
  }

  return mapped;
}

async function main(): Promise<void> {
  const requestedSeason = getArgValue('--season');
  const env = getEnv();
  const client = createSupabase(env).client;

  const season = requestedSeason ?? (await resolveLatestSeason(client));
  if (!season) {
    printParityWarnBanner();
    console.warn(`${LOG_PREFIX} Unable to determine season; aborting parity check.`);
    return;
  }

  console.log(`${LOG_PREFIX} Running parity check`, { season });

  let computedRows: TotalsRow[] = [];
  let stagingRows: TotalsRow[] = [];
  try {
    computedRows = await fetchComputedRows(client, season);
    stagingRows = await fetchStagingRows(client, season);
  } catch (error) {
    printParityWarnBanner();
    console.warn(`${LOG_PREFIX} Failed to fetch parity inputs`, error);
    return;
  }

  const stagingByKey = new Map<string, TotalsRow>();
  for (const row of stagingRows) {
    stagingByKey.set(`${row.season}|${row.player_id}`, row);
  }

  const mismatches: MismatchRow[] = [];
  for (const row of computedRows) {
    const key = `${row.season}|${row.player_id}`;
    const staging = stagingByKey.get(key) ?? {
      season: row.season,
      player_id: row.player_id,
      goals: 0,
      assists: 0,
      pen_min: 0,
    };
    const diffGoals = row.goals - staging.goals;
    const diffAssists = row.assists - staging.assists;
    const diffPenMin = row.pen_min - staging.pen_min;
    const goalsMismatch = Math.abs(diffGoals) >= 1;
    const assistsMismatch = Math.abs(diffAssists) >= 1;
    const penMinMismatch = Math.abs(diffPenMin) >= 2;

    if (goalsMismatch || assistsMismatch || penMinMismatch) {
      mismatches.push({
        season: row.season,
        player_id: row.player_id,
        staging_goals: staging.goals,
        computed_goals: row.goals,
        diff_goals: diffGoals,
        staging_assists: staging.assists,
        computed_assists: row.assists,
        diff_assists: diffAssists,
        staging_pen_min: staging.pen_min,
        computed_pen_min: row.pen_min,
        diff_pen_min: diffPenMin,
        abs_score: Math.max(Math.abs(diffGoals), Math.abs(diffAssists), Math.abs(diffPenMin)),
      });
    }
  }

  const topMismatches = [...mismatches]
    .sort((a, b) => b.abs_score - a.abs_score)
    .slice(0, 25);

  console.log(`${LOG_PREFIX} Summary`, {
    season,
    total_compared: computedRows.length,
    total_mismatches: mismatches.length,
    staging_rows: stagingRows.length,
  });

  if (mismatches.length > 0) {
    printParityWarnBanner();
    console.warn(`${LOG_PREFIX} Top mismatches (max 25)`);
    topMismatches.forEach((row, idx) => {
      console.warn(
        `${idx + 1}. season=${row.season} player_id=${row.player_id} diff(goals=${row.diff_goals}, assists=${row.diff_assists}, pen_min=${row.diff_pen_min}) computed(g=${row.computed_goals},a=${row.computed_assists},p=${row.computed_pen_min}) staging(g=${row.staging_goals},a=${row.staging_assists},p=${row.staging_pen_min})`,
      );
    });
  } else {
    console.log(`${LOG_PREFIX} No mismatches detected.`);
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main()
    .catch((error) => {
      printParityWarnBanner();
      console.warn(`${LOG_PREFIX} Unexpected failure`, error);
    })
    .finally(() => {
      process.exitCode = 0;
    });
}
