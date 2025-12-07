import { saveDebugResponse } from './debugCache.js';
import { fetchAjax } from './fetchAjax.js';
import {
  convertRowToRecord,
  extractDataArray,
  valueToString,
} from './ajaxUtils.js';
import { cleanText, parseNumber, resolvePosition } from './html.js';
import type { EnvConfig } from './env.js';
import type { PlayerStatsRow, Position } from './types.js';

export interface ScrapeAjaxResult {
  rows: PlayerStatsRow[];
  raw: string;
}

export async function scrapeSkatersAjax(env: EnvConfig): Promise<ScrapeAjaxResult> {
  // Use the captured curl env values verbatim so the POST body matches the working browser call.
  console.log('[debug] Skater form length:', env.skatersForm?.length);
  const { raw, data } = await fetchAjax({
    url: env.skatersEndpoint,
    formBody: env.skatersForm,
    referer: env.skatersUrl,
    userAgent: env.userAgent,
    cookie: env.cookie,
    label: 'Skater',
  });
  if (env.debugSaveHtml) {
    await saveDebugResponse('skaters.json', raw);
  }
  const rows = mapSkaterRows(data);
  return { rows, raw };
}

function mapSkaterRows(payload: unknown): PlayerStatsRow[] {
  const dataRows = extractDataArray(payload);
  if (!dataRows.length) {
    return [];
  }

  const headerTexts = inferHeaderTexts(dataRows[0]);

  const results: PlayerStatsRow[] = [];
  for (const row of dataRows) {
    let mapped: PlayerStatsRow | null = null;
    const record = convertRowToRecord(row, headerTexts);
    if (record) {
      mapped = mapRecordToSkater(record);
    }
    if (!mapped) {
      mapped = mapArrayToSkater(row);
    }
    if (mapped) {
      results.push(mapped);
    }
  }

  return results;
}

function mapArrayToSkater(row: unknown): PlayerStatsRow | null {
  if (!Array.isArray(row)) {
    return null;
  }

  const name = cleanText(valueToString(row[1]));
  const team = cleanText(valueToString(row[2]));
  if (!name || !team) {
    return null;
  }

  const position = resolvePosition(valueToString(row[3])) ?? inferPositionFromLabel(valueToString(row[3]));

  return {
    name,
    team,
    position,
    games: parseStatNumber(valueToString(row[4])),
    goals: parseStatNumber(valueToString(row[5])),
    assists: parseStatNumber(valueToString(row[6])),
    points: parseStatNumber(valueToString(row[7])),
    pen_min: parseStatNumber(valueToString(row[8])),
    shots: null,
    saves: null,
    save_pct: null,
  };
}

function mapRecordToSkater(record: Record<string, unknown>): PlayerStatsRow | null {
  const name = cleanText(
    getFirstValue(record, ['name', 'player', 'piel', 'vārds', 'vards', 'speletajs']),
  );
  const team = cleanText(getFirstValue(record, ['team', 'komanda', 'klubs']));
  if (!name || !team) {
    return null;
  }

  const positionValue = getFirstValue(record, ['position', 'pozicija', 'poz']);
  const position =
    resolvePosition(positionValue) ?? inferPositionFromLabel(positionValue) ?? 'U';

  return {
    name,
   team,
   position,
    games: parseStatNumber(getFirstValue(record, ['games', 'gp', 'speles'])),
    goals: parseStatNumber(getFirstValue(record, ['goals', 'g', 'varti'])),
    assists: parseStatNumber(getFirstValue(record, ['assists', 'a', 'piespeles'])),
    points: parseStatNumber(getFirstValue(record, ['points', 'punkti', 'pt'])),
    pen_min: parseStatNumber(getFirstValue(record, ['pen_min', 'pim', 'sodi'])),
    shots: null,
    saves: null,
    save_pct: null,
  };
}

function inferHeaderTexts(sample: unknown): string[] {
  if (Array.isArray(sample)) {
    return sample.map((_, index) => `col_${index}`);
  }
  if (sample && typeof sample === 'object') {
    return Object.keys(sample as Record<string, unknown>);
  }
  return [];
}

function getFirstValue(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) {
      return valueToString(value);
    }
  }
  return '';
}

function inferPositionFromLabel(value: string): Position {
  const normalized = value.toLowerCase();
  if (normalized.startsWith('v')) return 'V';
  if (normalized.startsWith('a')) return 'A';
  return 'U';
}

function parseStatNumber(value: string): number | null {
  if (!value) {
    return null;
  }
  const primary = value.split(/[\/]/)[0]?.trim() ?? value;
  return parseNumber(primary);
}
