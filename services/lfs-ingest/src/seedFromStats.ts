import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getEnv } from './env.js';
import { scrapeGoaliesAjax } from './scrapeGoaliesAjax.js';
import { scrapeSkatersAjax } from './scrapeSkatersAjax.js';
import { createSupabase } from './supa.js';
import type { PlayerSeasonStatsRow, PlayerStatsRow } from './types.js';

type Mode = 'seed' | 'refresh';

const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.cache');

export async function ingestSeasonStats(mode: Mode): Promise<void> {
  const env = getEnv();
  const supabase = createSupabase(env);

  let skaters: PlayerStatsRow[] = [];
  let goalies: PlayerStatsRow[] = [];

  console.log(`[${mode}] Fetching skater stats via AJAX…`);
  try {
    const result = await scrapeSkatersAjax(env);
    skaters = result.rows;
    if (!skaters.length) {
      console.warn(`[${mode}] Skater endpoint returned no rows.`);
      logRawPreview('Skater', result.raw);
      await saveRawResponse('last_skaters.json', result.raw);
    }
  } catch (error) {
    console.warn(`[${mode}] Skater AJAX fetch failed; continuing without skaters.`, error);
  }

  console.log(`[${mode}] Fetching goalie stats via AJAX…`);
  try {
    const result = await scrapeGoaliesAjax(env);
    goalies = result.rows;
    if (!goalies.length) {
      console.warn(`[${mode}] Goalie endpoint returned no rows.`);
      logRawPreview('Goalie', result.raw);
      await saveRawResponse('last_goalies.json', result.raw);
    }
  } catch (error) {
    console.warn(`[${mode}] Goalie AJAX fetch failed; continuing without goalies.`, error);
  }

  const rows: PlayerStatsRow[] = [...skaters, ...goalies];
  const stagingRows = rows.map(mapToSeasonStatsRow);

  if (!stagingRows.length) {
    console.warn(
      `[${mode}] No player rows scraped; clearing players_stats_staging and skipping insert.`,
    );
    await supabase.clearPlayerStatsStaging();
    return;
  }

  console.log(`[${mode}] Prepared ${stagingRows.length} rows for players_stats_staging`);
  try {
    await supabase.clearPlayerStatsStaging();
    const inserted = await supabase.insertPlayerSeasonStats(stagingRows);
    console.log(`[${mode}] Inserted ${inserted} rows into players_stats_staging`);
  } catch (error) {
    console.error(`[${mode}] Failed to insert rows into players_stats_staging`, error);
    throw error;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  ingestSeasonStats('seed').catch((error) => {
    console.error('[seed] Fatal error', error);
    process.exitCode = 1;
  });
}

function mapToSeasonStatsRow(row: PlayerStatsRow): PlayerSeasonStatsRow {
  return {
    name: row.name,
    team: row.team,
    position: row.position,
    games: row.games,
    goals: row.goals,
    assists: row.assists,
    points: row.points,
    saves: row.saves,
    save_pct: row.save_pct,
    penalty_min: row.pen_min,
  };
}

function logRawPreview(label: string, raw: string): void {
  const preview = raw.slice(0, 300);
  console.debug(`[debug] ${label} raw HTML (first 300 chars): ${JSON.stringify(preview)}`);
}

async function saveRawResponse(filename: string, raw: string): Promise<void> {
  if (!raw) {
    return;
  }

  const output = formatRaw(raw);

  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(join(CACHE_DIR, filename), output, 'utf8');
  } catch (error) {
    console.warn(`[debug] Failed to write ${filename}`, error);
  }
}

function formatRaw(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}
