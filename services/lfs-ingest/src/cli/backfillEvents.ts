import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getEnv } from '../env.js';
import { createSupabase } from '../supa.js';
import { fetchWithRetry } from '../http.js';

type MatchRow = {
  id: string;
  external_id: string | null;
  home_score: number | null;
  away_score: number | null;
  date: string | null;
  season: string | null;
};

type EventCounts = { total: number; goals: number };

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function getArgValue(args: string[], flag: string, fallback: string | null = null): string | null {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  const withEq = args.find((a) => a.startsWith(`${flag}=`));
  if (withEq) return withEq.split('=')[1] ?? fallback;
  return fallback;
}

async function runCli(command: string, args: string[]): Promise<void> {
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
      console.error('[backfill] LFS access check failed', { status, url });
      process.exit(1);
    }
    console.log('[backfill] LFS access check OK', { status });
  } catch (err) {
    console.error('[backfill] LFS access check failed', { url, error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
}

async function fetchFinishedMatches(
  client: ReturnType<typeof createSupabase>['client'],
  days: number,
): Promise<MatchRow[]> {
  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from('matches')
    .select('id, external_id, home_score, away_score, date, season')
    .eq('status', 'finished')
    .gte('date', sinceDate)
    .order('date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as MatchRow[];
}

async function fetchEventCounts(
  client: ReturnType<typeof createSupabase>['client'],
  matchIds: string[],
): Promise<Map<string, EventCounts>> {
  const map = new Map<string, EventCounts>();
  const chunkSize = 200;
  for (let i = 0; i < matchIds.length; i += chunkSize) {
    const chunk = matchIds.slice(i, i + chunkSize);
    const { data, error } = await client
      .from('match_events')
      .select('match_id,event_type')
      .in('match_id', chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      const id = (row as any).match_id as string;
      const type = (row as any).event_type as string;
      const current = map.get(id) ?? { total: 0, goals: 0 };
      current.total += 1;
      if (type === 'goal') current.goals += 1;
      map.set(id, current);
    }
  }
  return map;
}

async function fetchPmpCounts(
  client: ReturnType<typeof createSupabase>['client'],
  matchIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const chunkSize = 200;
  for (let i = 0; i < matchIds.length; i += chunkSize) {
    const chunk = matchIds.slice(i, i + chunkSize);
    const { data, error } = await client
      .from('player_match_points')
      .select('match_id')
      .in('match_id', chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      const id = (row as any).match_id as string;
      map.set(id, (map.get(id) ?? 0) + 1);
    }
  }
  return map;
}

function isSuspicious(match: MatchRow, events: EventCounts | undefined): boolean {
  const totalGoals = (match.home_score ?? 0) + (match.away_score ?? 0);
  const ev = events ?? { total: 0, goals: 0 };
  if (ev.total === 0) return true;
  if (totalGoals > 0 && ev.goals < totalGoals) return true;
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  const days = Number.parseInt(getArgValue(args, '--days', '14') ?? '14', 10);
  const env = getEnv();
  const supa = createSupabase(env);

  await assertLfsAccess(env);

  console.log('[backfill] scanning finished matches', { days });
  const matches = await fetchFinishedMatches(supa.client, days);
  const matchIds = matches.map((m) => m.id);
  const eventCounts = await fetchEventCounts(supa.client, matchIds);
  const pmpCounts = await fetchPmpCounts(supa.client, matchIds);

  const suspicious = matches.filter((m) => isSuspicious(m, eventCounts.get(m.id)));

  console.log('[backfill] summary', {
    window_days: days,
    finished_matches: matches.length,
    suspicious_count: suspicious.length,
  });

  if (suspicious.length === 0) {
    console.log('[backfill] no suspicious matches found');
    return;
  }

  let succeeded = 0;
  let failed = 0;
  const failures: { external_id: string | null; reason: string }[] = [];

  for (let i = 0; i < suspicious.length; i += 1) {
    const match = suspicious[i];
    console.log(`[backfill] [${i + 1}/${suspicious.length}] re-ingesting`, {
      match_id: match.id,
      external_id: match.external_id,
      date: match.date,
      event_counts: eventCounts.get(match.id) ?? { total: 0, goals: 0 },
      pmp_rows: pmpCounts.get(match.id) ?? 0,
    });

    if (!match.external_id) {
      console.warn('[backfill] skip missing external_id', { match_id: match.id });
      failures.push({ external_id: null, reason: 'missing external_id' });
      failed += 1;
      continue;
    }

    try {
      await runCli('npx', ['tsx', 'src/ingestMatchEvents.ts', '--externalId', match.external_id]);
      await runCli('npx', ['tsx', 'src/computeMatchPoints.ts', '--matchId', match.id]);
      succeeded += 1;
    } catch (err: any) {
      const reason = err?.message ?? 'unknown error';
      failures.push({ external_id: match.external_id, reason });
      failed += 1;
      console.error('[backfill] failed', { external_id: match.external_id, reason });
    }
  }

  console.log('[backfill] RESULTS', {
    window_days: days,
    suspicious_count: suspicious.length,
    succeeded,
    failed,
    failures_sample: failures.slice(0, 10),
  });

  if (failed > 0 && succeeded === 0) {
    console.warn('[backfill] all suspicious matches failed to ingest; continuing with non-fatal warning');
    process.exitCode = 0;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((err) => {
    console.error('[backfill] Fatal error', err);
    process.exitCode = 1;
  });
}
