import { pathToFileURL } from 'node:url';
import { getEnv } from './env.js';
import { createSupabase } from './supa.js';

type PlayerRow = {
  id: string;
  name: string | null;
  team_id: string | null;
  games: number | null;
  created_at: string | null;
};

const LOG_PREFIX = '[cleanup:junk-players]';
const JUNK_KEYWORDS = ['soda laika', 'nepilnos sastavos', 'speles beigas', 'komandu sastavi', 'kopsavilkums'];

function normalizeCandidate(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

function isJunkName(name: string | null | undefined): boolean {
  const normalized = normalizeCandidate(name);
  if (!normalized) return true;
  if (!/[a-z]/i.test(normalized)) return true;
  if (/^[()\[\]{}.,;:\-\s]+$/.test(name ?? '')) return true;
  return JUNK_KEYWORDS.some((kw) => normalized.includes(kw));
}

async function fetchJunkPlayers(supabase: ReturnType<typeof createSupabase>['client']): Promise<PlayerRow[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('players')
    .select('id, name, team_id, games, created_at')
    .or('games.is.null,team_id.is.null')
    .gte('created_at', since);

  if (error) {
    throw error;
  }

  return (data ?? []) as PlayerRow[];
}

async function nullAssistsForPlayers(
  supabase: ReturnType<typeof createSupabase>['client'],
  playerIds: string[],
): Promise<number> {
  if (!playerIds.length) return 0;

  const { error, data } = await supabase.from('match_events').update({ assist_id: null }).in('assist_id', playerIds).select('id');

  if (error) {
    throw error;
  }

  return data?.length ?? 0;
}

async function deletePlayers(
  supabase: ReturnType<typeof createSupabase>['client'],
  playerIds: string[],
): Promise<number> {
  if (!playerIds.length) return 0;

  const { error, data } = await supabase.from('players').delete().in('id', playerIds).select('id');
  if (error) {
    throw error;
  }
  return data?.length ?? 0;
}

async function main(): Promise<void> {
  const env = getEnv();
  const supabase = createSupabase(env).client;

  console.log(`${LOG_PREFIX} Loading candidate junk players...`);
  const candidates = await fetchJunkPlayers(supabase);
  const junk = candidates.filter((p) => isJunkName(p.name));

  if (!junk.length) {
    console.log(`${LOG_PREFIX} No junk players found. Nothing to do.`);
    return;
  }

  const playerIds = junk.map((p) => p.id);
  const sample = junk.slice(0, 10).map((p) => ({ id: p.id, name: p.name, team_id: p.team_id, created_at: p.created_at }));
  console.log(`${LOG_PREFIX} Junk players detected`, { count: junk.length, sample });

  console.log(`${LOG_PREFIX} Clearing assist references...`);
  const assistsCleared = await nullAssistsForPlayers(supabase, playerIds);
  console.log(`${LOG_PREFIX} Assist references cleared: ${assistsCleared}`);

  console.log(`${LOG_PREFIX} Deleting players...`);
  const deleted = await deletePlayers(supabase, playerIds);
  console.log(`${LOG_PREFIX} Players deleted: ${deleted}`);

  console.log(`${LOG_PREFIX} Summary`, { players_deleted: deleted, assists_cleared: assistsCleared });
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error) => {
    console.error(`${LOG_PREFIX} Fatal error`, error);
    process.exitCode = 1;
  });
}
