import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { getEnv } from '../env.js';
import { createSupabase } from '../supa.js';
import { fetchWithRetry } from '../http.js';

type MatchRow = { id: string; external_id: string | null; status: string | null; season: string | null; date: string | null };

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RECENT_DAYS = 7;

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
    .select('id, external_id, status, season, date')
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
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      env: process.env,
      stdio: 'inherit',
    });
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

async function fetchCountsByMatch(
  client: ReturnType<typeof createSupabase>['client'],
  table: 'match_events' | 'match_goalie_stats',
  matchIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (matchIds.length === 0) return map;
  const { data, error } = await client.from(table).select('match_id').in('match_id', matchIds);
  if (error) {
    throw error;
  }
  for (const row of data ?? []) {
    const id = (row as any).match_id as string | null;
    if (!id) continue;
    map.set(id, (map.get(id) ?? 0) + 1);
  }
  return map;
}

async function assertLfsAccess(env: ReturnType<typeof getEnv>): Promise<void> {
  const url = 'https://www.floorball.lv/lv/';
  try {
    const { status } = await fetchWithRetry(url, {
      headers: {
        'user-agent': env.userAgent,
        cookie: env.cookie,
      },
    });
    if (status !== 200) {
      console.error('[cli] LFS access check failed', { status, url });
      process.exit(1);
    }
    console.log('[cli] LFS access check OK', { status });
  } catch (err) {
    console.error('[cli] LFS access check failed', { url, error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
}

async function main() {
  // Fail fast if env missing
  const env = getEnv();
  const supa = createSupabase(env);
  const season = '2025-26';
  const args = process.argv.slice(2);
  const backfill = args.includes('--backfill');

  await assertLfsAccess(env);

  console.log(`[cli] mode=${backfill ? 'backfill' : 'incremental'}`);

  console.log('[cli] Loading finished matches for season', season);
  const matches = await fetchFinishedMatches(supa.client, season);
  console.log('[cli] total_finished', matches.length);

  const matchIds = matches.map((m) => m.id);
  const eventCounts = await fetchCountsByMatch(supa.client, 'match_events', matchIds);
  const goalieCounts = await fetchCountsByMatch(supa.client, 'match_goalie_stats', matchIds);

  const recentCutoff = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const recentMatches = matches.filter((m) => {
    if (!m.date) return false;
    const d = new Date(m.date);
    return Number.isFinite(d.valueOf()) && d >= recentCutoff;
  });

  const missingEvents = matches.filter((m) => (eventCounts.get(m.id) ?? 0) === 0);
  const missingGoalies = matches.filter((m) => (goalieCounts.get(m.id) ?? 0) === 0);

  const missingEventsSet = new Set(missingEvents.map((m) => m.id));
  const missingGoaliesSet = new Set(missingGoalies.map((m) => m.id));
  const recentSet = new Set(recentMatches.map((m) => m.id));

  const matchesNeedingIngest = backfill
    ? matches
    : matches.filter((m) => missingEventsSet.has(m.id) || missingGoaliesSet.has(m.id) || recentSet.has(m.id));

  console.log('[cli] Selection', {
    total_finished: matches.length,
    recent_window_days: RECENT_DAYS,
    recent_candidates: recentMatches.length,
    missing_events_count: missingEvents.length,
    missing_goalie_stats_count: missingGoalies.length,
    matches_to_process: matchesNeedingIngest.length,
  });
  console.log('[cli] Selection breakdown', {
    selected_for_processing_count: matchesNeedingIngest.length,
    selected_recent_count: matchesNeedingIngest.filter((m) => recentSet.has(m.id)).length,
    selected_missing_events_count: matchesNeedingIngest.filter((m) => missingEventsSet.has(m.id)).length,
    selected_missing_goalies_count: matchesNeedingIngest.filter((m) => missingGoaliesSet.has(m.id)).length,
  });

  let totalEvents = 0;
  let totalGoalieRows = 0;
  let totalPmpRows = 0;
  const processed: MatchRow[] = [];
  const skipped: { match: MatchRow; reason: string }[] = [];
  const failed: { match: MatchRow; reason: string }[] = [];

  for (let i = 0; i < matchesNeedingIngest.length; i += 1) {
    const match = matchesNeedingIngest[i];
    console.log(`[cli] [${i + 1}/${matchesNeedingIngest.length}] ingesting match ${match.id} ext=${match.external_id ?? ''}`);

    if (!match.external_id || !/^[0-9]/.test(match.external_id)) {
      const reason = 'non-numeric external_id';
      console.warn(`[cli] skipping match ${match.id} (${match.external_id ?? 'n/a'}) - ${reason}`);
      skipped.push({ match, reason });
      continue;
    }

    try {
      await runCli('npx', ['tsx', 'src/ingestMatchEvents.ts', '--matchId', match.id]);
      const eventCount = await countMatchEvents(supa.client, match.id);
      const goalieCount = await countGoalieStats(supa.client, match.id);
      const skippedByIngest = eventCount === 0 && goalieCount === 0;

      if (skippedByIngest) {
        const reason = 'ingest returned zero rows (likely skip/404)';
        console.warn(`[cli] skipping match ${match.id} (${match.external_id ?? ''}) - ${reason}`);
        skipped.push({ match, reason });
        continue;
      }

      totalEvents += eventCount;
      totalGoalieRows += goalieCount;

      console.log(`[cli] computing points matchId=${match.id} ext=${match.external_id ?? ''}`);
      await runCli('npx', ['tsx', 'src/computeMatchPoints.ts', '--matchId', match.id]);
      console.log(`[cli] computed points for ${match.id}`);
      const pmpCount = await countPlayerMatchPoints(supa.client, match.id);
      totalPmpRows += pmpCount;
      processed.push(match);
    } catch (err: any) {
      const reason = err?.message ?? 'unknown error';
      console.error(`[cli] match failed ${match.id} (${match.external_id ?? ''})`, err);
      failed.push({ match, reason });
    }
  }

  const { assistsSum, goalieMatches } = await fetchSanityAssistAndGoalies(supa.client);

  const summary = {
    season,
    total_finished_matches: matches.length,
    matches_needing_protocol: matchesNeedingIngest.length,
    processed_count: processed.length,
    skipped_count: skipped.length,
    skipped_samples: skipped.slice(0, 10).map((s) => s.match.external_id ?? 'n/a'),
    failed_count: failed.length,
    failed_samples: failed.slice(0, 10).map((f) => `${f.match.external_id ?? 'n/a'}:${f.reason}`),
    match_events_rows: totalEvents,
    match_goalie_stats_rows: totalGoalieRows,
    player_match_points_rows: totalPmpRows,
    assists_sum: assistsSum,
    goalie_match_count_with_saves: goalieMatches,
  };
  console.log('[cli] SUMMARY', summary);

  if (failed.length === 0) {
    process.exitCode = 0;
  } else {
    const failRatio = failed.length / Math.max(1, matchesNeedingIngest.length);
    if (failRatio >= 0.2) {
      process.exitCode = 1;
    } else {
      console.warn(`[cli] some matches failed but under threshold (${failed.length}/${matchesNeedingIngest.length})`);
      process.exitCode = 0;
    }
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((err) => {
    console.error('[cli] Fatal error', err);
    process.exitCode = 1;
  });
}
