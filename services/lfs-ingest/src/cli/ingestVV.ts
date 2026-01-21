import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { getEnv } from '../env.js';
import { createSupabase } from '../supa.js';

type MatchRow = { id: string; external_id: string | null; status: string | null; season: string | null };

async function countMatchEvents(client: ReturnType<typeof createSupabase>['client'], matchId: string): Promise<number> {
  const { count } = await client.from('match_events').select('id', { count: 'exact', head: true }).eq('match_id', matchId);
  return count ?? 0;
}

async function countGoalieStats(client: ReturnType<typeof createSupabase>['client'], matchId: string): Promise<number> {
  const { count } = await client.from('match_goalie_stats').select('player_id', { count: 'exact', head: true }).eq('match_id', matchId);
  return count ?? 0;
}

async function countPlayerMatchPoints(
  client: ReturnType<typeof createSupabase>['client'],
  matchId: string,
): Promise<number> {
  const { count } = await client.from('player_match_points').select('id', { count: 'exact', head: true }).eq('match_id', matchId);
  return count ?? 0;
}

async function fetchFinishedMatches(
  client: ReturnType<typeof createSupabase>['client'],
  season: string,
): Promise<MatchRow[]> {
  const { data, error } = await client
    .from('matches')
    .select('id, external_id, status, season')
    .eq('season', season)
    .eq('status', 'finished')
    .order('date', { ascending: true });
  if (error) {
    throw error;
  }
  return (data ?? []) as MatchRow[];
}

function runCli(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: process.env, cwd: new URL('..', import.meta.url).pathname });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
    child.on('error', (err) => reject(err));
  });
}

async function fetchSanityAssistAndGoalies(client: ReturnType<typeof createSupabase>['client']): Promise<{
  assistsSum: number;
  goalieMatches: number;
}> {
  const { data: assistsData } = await client
    .from('player_match_points')
    .select('assists')
    .neq('assists', null);
  const assistsSum = (assistsData ?? []).reduce((sum, row) => sum + (Number((row as any).assists) || 0), 0);

  const { data: goalieData } = await client
    .from('player_match_points')
    .select('match_id')
    .eq('position', 'V')
    .gt('saves', 0);
  const goalieMatches = new Set((goalieData ?? []).map((row) => (row as any).match_id)).size;

  return { assistsSum, goalieMatches };
}

async function main() {
  // Fail fast if env missing
  getEnv();
  const supa = createSupabase(getEnv());
  const season = '2025-26';

  console.log('[cli] Loading finished matches for season', season);
  const matches = await fetchFinishedMatches(supa.client, season);
  console.log('[cli] total_finished', matches.length);

  const matchesNeedingIngest: MatchRow[] = [];
  for (const match of matches) {
    const eventsCount = await countMatchEvents(supa.client, match.id);
    const goalieCount = await countGoalieStats(supa.client, match.id);
    if (eventsCount === 0 || goalieCount === 0) {
      matchesNeedingIngest.push(match);
    }
  }

  console.log('[cli] Matches needing protocol ingest', matchesNeedingIngest.length);

  let totalEvents = 0;
  let totalGoalieRows = 0;
  let totalPmpRows = 0;

  for (let i = 0; i < matchesNeedingIngest.length; i += 1) {
    const match = matchesNeedingIngest[i];
    console.log(`[cli] [${i + 1}/${matchesNeedingIngest.length}] ingesting match ${match.id} ext=${match.external_id ?? ''}`);
    await runCli('npx', ['tsx', 'src/ingestMatchEvents.ts', '--matchId', match.id]);
    const eventCount = await countMatchEvents(supa.client, match.id);
    const goalieCount = await countGoalieStats(supa.client, match.id);
    totalEvents += eventCount;
    totalGoalieRows += goalieCount;

    console.log(`[cli] computing points for ${match.id}`);
    await runCli('npx', ['tsx', 'src/computeMatchPoints.ts', match.id]);
    const pmpCount = await countPlayerMatchPoints(supa.client, match.id);
    totalPmpRows += pmpCount;
  }

  const { assistsSum, goalieMatches } = await fetchSanityAssistAndGoalies(supa.client);

  console.log('[cli] SUMMARY', {
    season,
    total_finished_matches: matches.length,
    matches_processed: matchesNeedingIngest.length,
    match_events_rows: totalEvents,
    match_goalie_stats_rows: totalGoalieRows,
    player_match_points_rows: totalPmpRows,
    assists_sum: assistsSum,
    goalie_match_count_with_saves: goalieMatches,
  });
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((err) => {
    console.error('[cli] Fatal error', err);
    process.exitCode = 1;
  });
}
