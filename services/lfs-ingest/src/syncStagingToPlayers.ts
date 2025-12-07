import { pathToFileURL } from 'node:url';
import { getEnv } from './env.js';
import { createSupabase } from './supa.js';
import type { PlayerSeasonStatsRow, Position } from './types.js';

type TeamRow = {
  id: string;
  name?: string | null;
  short_name?: string | null;
};

type PlayerInsertRow = {
  name: string;
  team?: string | null;
  team_id?: string | null;
  position: Position;
  games?: number | null;
  goals?: number | null;
  assists?: number | null;
  points?: number | null;
  points_total?: number | null;
  saves?: number | null;
  save_pct?: number | null;
  penalty_min?: number | null;
};

async function main(): Promise<void> {
  console.log('[sync] Starting sync from players_stats_staging to players…');
  const env = getEnv();
  const supa = createSupabase(env);
  const supabase = supa.client;

  const { data: stagingRows, error: stagingError } = await supabase
    .from('players_stats_staging')
    .select('*');

  if (stagingError) {
    console.error('[sync] Failed to load players_stats_staging', stagingError);
    return;
  }

  const rows = stagingRows ?? [];
  console.log(`[sync] Loaded ${rows.length} rows from players_stats_staging`);
  if (!rows.length) {
    console.warn('[sync] No staging rows; aborting sync.');
    return;
  }

  const teamNames = Array.from(
    new Set(
      rows
        .map((row) => canonicalTeamName(row.team))
        .filter((name): name is string => Boolean(name)),
    ),
  );

  const { data: existingTeams, error: teamsError } = await supabase.from('teams').select('*');
  if (teamsError) {
    console.error('[sync] Failed to load teams', teamsError);
    return;
  }

  const existingTeamsByName = new Map<string, TeamRow>();
  for (const team of existingTeams ?? []) {
    const name = canonicalTeamName(team.name);
    if (name) {
      existingTeamsByName.set(name, team as TeamRow);
    }
  }

  const missingTeams = teamNames.filter((name) => !existingTeamsByName.has(name));
  console.log(
    `[sync] Found ${existingTeamsByName.size} existing teams, inserting ${missingTeams.length} new teams`,
  );

  if (missingTeams.length) {
    const sampleTeam = existingTeams?.[0] as TeamRow | undefined;
    const toInsert = missingTeams
      .map((name) => {
        const code = makeTeamCode(name);
        if (!code) {
          console.warn('[sync] Skipping team with empty code/name', { name });
          return null;
        }
        return {
          code,
          name,
          // If the table has short_name, reuse the full name for now to keep inserts simple.
          ...(sampleTeam && 'short_name' in sampleTeam ? { short_name: name } : {}),
        };
      })
      .filter((row): row is { code: string; name: string; short_name?: string } => Boolean(row));

    if (toInsert.length) {
      console.log(
        '[sync] Inserting new teams:',
        toInsert.map((t) => ({ code: t.code, name: t.name })),
      );

      const { error: insertTeamsError } = await supabase.from('teams').insert(toInsert);
      if (insertTeamsError) {
        console.error('[sync] Failed to insert new teams', insertTeamsError);
        return;
      }
    }
  }

  // Reload full team list to build name -> id map.
  const { data: allTeams, error: reloadTeamsError } = await supabase.from('teams').select('*');
  if (reloadTeamsError) {
    console.error('[sync] Failed to reload teams', reloadTeamsError);
    return;
  }

  const teamIdByName = new Map<string, string>();
  for (const team of allTeams ?? []) {
    const name = canonicalTeamName(team.name);
    if (name && team.id) {
      teamIdByName.set(name, team.id);
    }
  }

  // Peek at current players columns to avoid inserting unknown fields if schema differs.
  const { data: playerSample } = await supabase.from('players').select('*').limit(1);
  const playerColumns = new Set<string>(
    Object.keys(playerSample?.[0] ?? {}).map((key) => key.toLowerCase()),
  );
  if (!playerColumns.size) {
    // Assume common stat columns exist when the table is empty so we still write useful data.
    [
      'team',
      'games',
      'goals',
      'assists',
      'points',
      'points_total',
      'saves',
      'save_pct',
      'penalty_min',
    ].forEach((key) => playerColumns.add(key));
  }

  const playerRows: PlayerInsertRow[] = rows.map((row: PlayerSeasonStatsRow) => {
    const teamName = canonicalTeamName(row.team) || null;
    const teamId = teamName ? teamIdByName.get(teamName) ?? null : null;
    const base: PlayerInsertRow = {
      name: row.name,
      position: normalizePosition(row.position),
    };
    if (playerColumns.has('team')) base.team = teamName;
    if (playerColumns.has('team_id')) base.team_id = teamId;
    if (playerColumns.has('games')) base.games = row.games;
    if (playerColumns.has('goals')) base.goals = row.goals;
    if (playerColumns.has('assists')) base.assists = row.assists;
    if (playerColumns.has('points')) base.points = row.points ?? 0;
    // points_total is NOT NULL in players; default to 0 when staging is missing.
    if (playerColumns.has('points_total')) base.points_total = row.points ?? 0;
    if (playerColumns.has('saves')) base.saves = row.saves;
    if (playerColumns.has('save_pct')) base.save_pct = row.save_pct;
    if (playerColumns.has('penalty_min')) base.penalty_min = row.penalty_min ?? 0;
    return base;
  });

  // Delete all existing players; PostgREST requires a filter.
  const { data: deletedPlayers, error: deleteError } = await supabase
    .from('players')
    .delete()
    // Use a valid UUID comparison to satisfy PostgREST filter requirement on UUID PK.
    .neq('id', '00000000-0000-0000-0000-000000000000')
    .select('id');

  if (deleteError) {
    console.error('[sync] Failed to delete existing players', deleteError);
    return;
  }

  console.log(`[sync] Deleted ${deletedPlayers?.length ?? 0} players from players`);

  const { error: insertPlayersError, count: insertedCount } = await supabase
    .from('players')
    .insert(playerRows, { count: 'exact' });

  if (insertPlayersError) {
    console.error('[sync] Failed to insert players into players', insertPlayersError);
    return;
  }

  console.log(`[sync] Inserted ${insertedCount ?? playerRows.length} players into players`);
  console.log('[sync] Done syncing players.');
}

function normalizePosition(position: Position): Position {
  if (!position) return 'U';
  const value = position.toString().toUpperCase();
  if (value.startsWith('V')) return 'V';
  if (value.startsWith('A')) return 'A';
  if (value.startsWith('U')) return 'U';
  // Default to utility if unexpected value slips through.
  return 'U';
}

function stripHtml(input: string | null | undefined): string {
  if (!input) return '';
  return input.replace(/<[^>]*>/g, '').trim();
}

function canonicalTeamName(raw: string | null | undefined): string {
  return stripHtml(raw).trim();
}

function makeTeamCode(name: string): string {
  const cleaned = stripHtml(name);
  if (!cleaned) return '';
  return cleaned
    .normalize('NFKD')
    .replace(/[^\w\s]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
    .slice(0, 32);
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error) => {
    console.error('[sync] Fatal error', error);
    process.exitCode = 1;
  });
}
