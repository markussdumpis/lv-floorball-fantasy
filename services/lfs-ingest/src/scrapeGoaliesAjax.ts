import { saveDebugResponse } from './debugCache.js';
import { fetchAjax } from './fetchAjax.js';
import {
  convertRowToRecord,
  extractDataArray,
  valueToString,
} from './ajaxUtils.js';
import { cleanText, parseNumber, parsePercent } from './html.js';
import type { EnvConfig } from './env.js';
import type { PlayerStatsRow } from './types.js';

export interface ScrapeAjaxResult {
  rows: PlayerStatsRow[];
  raw: string;
}

export async function scrapeGoaliesAjax(env: EnvConfig): Promise<ScrapeAjaxResult> {
  // Use the captured curl env values verbatim so the POST body matches the working browser call.
  console.log('[debug] Goalie form length:', env.goaliesForm?.length);
  const { raw, data } = await fetchAjax({
    url: env.goaliesEndpoint,
    formBody: env.goaliesForm,
    referer: env.goaliesUrl,
    userAgent: env.userAgent,
    cookie: env.cookie,
    label: 'Goalie',
  });
  if (env.debugSaveHtml) {
    await saveDebugResponse('goalies.json', raw);
  }
  const rows = mapGoalieRows(data);
  return { rows, raw };
}

function mapGoalieRows(payload: unknown): PlayerStatsRow[] {
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
      mapped = mapRecordToGoalie(record);
    }
    if (!mapped) {
      mapped = mapArrayToGoalie(row);
    }
    if (mapped) {
      results.push(mapped);
    }
  }

  return results;
}

function mapArrayToGoalie(row: unknown): PlayerStatsRow | null {
  if (!Array.isArray(row)) {
    return null;
  }

  const name = cleanText(valueToString(row[1]));
  const team = cleanText(valueToString(row[2]));
  if (!name || !team) {
    return null;
  }

  return {
    name,
    team,
    position: 'V',
    games: parseStatNumber(valueToString(row[3])),
    goals: null,
    assists: parseStatNumber(valueToString(row[4])),
    points: null,
    shots: parseStatNumber(valueToString(row[6])),
    saves: parseStatNumber(valueToString(row[8])),
    save_pct: parsePercent(valueToString(row[9])),
    pen_min: parseStatNumber(valueToString(row[10])),
  };
}

function mapRecordToGoalie(record: Record<string, unknown>): PlayerStatsRow | null {
  const name = cleanText(
    getFirstValue(record, ['name', 'player', 'vartsargs', 'vārtsargs', 'vards']),
  );
  const team = cleanText(getFirstValue(record, ['team', 'komanda']));
  if (!name || !team) {
    return null;
  }

  return {
    name,
    team,
    position: 'V',
    games: parseStatNumber(getFirstValue(record, ['games', 'speles', 'gp'])),
    goals: null,
    assists: parseStatNumber(getFirstValue(record, ['assists', 'a'])),
    points: null,
    shots: parseStatNumber(getFirstValue(record, ['shots', 'metieni'])),
    saves: parseStatNumber(getFirstValue(record, ['saves', 'atvairiti'])),
    save_pct: parsePercent(getFirstValue(record, ['save_pct', 'atvairito%', 'proc'])),
    pen_min: parseStatNumber(getFirstValue(record, ['pen_min', 'pim', 'sodi'])),
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

function parseStatNumber(value: string): number | null {
  if (!value) {
    return null;
  }
  const primary = value.split(/[\/]/)[0]?.trim() ?? value;
  return parseNumber(primary);
}
