import { load, type CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import type { Position } from './types.js';

export type HeaderKey =
  | 'name'
  | 'team'
  | 'position'
  | 'games'
  | 'goals'
  | 'assists'
  | 'points'
  | 'pen_min'
  | 'saves'
  | 'save_pct'
  | 'price_raw'
  | 'price_final';

type HeaderAliasMap = Record<string, HeaderKey>;

const HEADER_ALIASES: HeaderAliasMap = {
  player: 'name',
  players: 'name',
  speletaji: 'name',
  name: 'name',
  speletajs: 'name',
  speletaja: 'name',
  vards: 'name',
  uzvards: 'name',
  komanda: 'team',
  komandas: 'team',
  team: 'team',
  club: 'team',
  position: 'position',
  pozicija: 'position',
  poz: 'position',
  gp: 'games',
  games: 'games',
  speles: 'games',
  spelu: 'games',
  gms: 'games',
  goals: 'goals',
  varti: 'goals',
  vartu: 'goals',
  a: 'assists',
  assists: 'assists',
  piespeles: 'assists',
  asistences: 'assists',
  points: 'points',
  punkti: 'points',
  pts: 'points',
  pm: 'pen_min',
  pim: 'pen_min',
  sodi: 'pen_min',
  'sodu minutes': 'pen_min',
  saves: 'saves',
  atvairijumi: 'saves',
  save: 'save_pct',
  'save percent': 'save_pct',
  'save pct': 'save_pct',
  'save percentage': 'save_pct',
  procents: 'save_pct',
  procenti: 'save_pct',
  percent: 'save_pct',
};

const KEYWORD_MATCHERS: Array<{ key: HeaderKey; keywords: string[] }> = [
  { key: 'name', keywords: ['vards', 'vardu', 'spel', 'name'] },
  { key: 'team', keywords: ['komand', 'team', 'klub'] },
  { key: 'games', keywords: ['speles', 'spelu', 'sp', 'games', 'gp'] },
  { key: 'goals', keywords: ['varti', 'goals'] },
  { key: 'assists', keywords: ['piespel', 'assist', 'asist'] },
  { key: 'points', keywords: ['punkt', 'points', 'pts'] },
  { key: 'pen_min', keywords: ['sodi', 'sodu', 'pim', 'min'] },
  { key: 'saves', keywords: ['atvairij', 'saves', 'atvari'] },
  { key: 'save_pct', keywords: ['proc', 'percent', 'save', '%'] },
  { key: 'price_raw', keywords: ['raw', 'sakotn'] },
  { key: 'price_final', keywords: ['final', 'gala', 'adjust'] },
];

export interface FindTableOptions {
  requiredAll: HeaderKey[];
  requiredAny?: HeaderKey[];
}

export interface TableMatch {
  table: Element;
  headers: Array<HeaderKey | null>;
  headerTexts: string[];
}

const FINAL_PRICE_TOKENS = ['final', 'finala', 'finalais', 'adjusted', 'gala', 'final price', 'pec'];
const RAW_PRICE_TOKENS = ['raw', 'pirms', 'sakotneja'];

export function loadHtml(html: string): CheerioAPI {
  return load(html);
}

export function findTableByHeaders(
  $: CheerioAPI,
  input: HeaderKey[] | FindTableOptions,
): TableMatch | null {
  const options: FindTableOptions = Array.isArray(input)
    ? { requiredAll: input }
    : input;
  const requiredAll = options.requiredAll ?? [];
  const requiredAny = options.requiredAny ?? [];

  const tables = $('table').toArray() as Element[];

  for (const table of tables) {
    const headerTexts = getHeaderTexts($, table);
    if (headerTexts.length === 0) {
      continue;
    }

    const headers = headerTexts.map((text) => resolveHeaderKey(text));
    const recognized = new Set<HeaderKey>();
    headers.forEach((header) => {
      if (header) {
        recognized.add(header);
      }
    });

    headerTexts.forEach((text, index) => {
      if (headers[index]) {
        return;
      }
      const goalieMatch = matchGoalieHeaderKey(text);
      const mapped = goalieGoalKeyToHeaderKey(goalieMatch);
      if (mapped) {
        headers[index] = mapped;
        recognized.add(mapped);
      }
    });

    if (!includesRequiredHeaders(recognized, requiredAll)) {
      continue;
    }

    if (!includesAny(recognized, requiredAny)) {
      continue;
    }

    return { table, headers, headerTexts };
  }

  return null;
}

export function extractRecords(
  $: CheerioAPI,
  table: Element,
  headers: Array<HeaderKey | null>,
): Array<Partial<Record<HeaderKey, string>>> {
  const records: Array<Partial<Record<HeaderKey, string>>> = [];

  const rows = $(table).find('tr').toArray() as Element[];
  rows.forEach((row) => {
    const cells = $(row).find('td').toArray() as Element[];
    if (cells.length === 0) {
      return;
    }

    const record: Partial<Record<HeaderKey, string>> = {};
    cells.forEach((cell, index) => {
      const header = headers[index];
      if (!header) {
        return;
      }
      record[header] = cleanText($(cell).text());
    });

    records.push(record);
  });

  return records;
}

export function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();
}

export function parseNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/[^0-9,\.\-]/g, '').replace(',', '.');
  if (!normalized) {
    return null;
  }

  const asNumber = Number(normalized);
  return Number.isFinite(asNumber) ? asNumber : null;
}

export function parsePercent(value: string | undefined): number | null {
  const number = parseNumber(value);
  if (number === null) {
    return null;
  }

  return number > 1 && number <= 100 ? number : number * 100;
}

export function resolvePosition(value: string): Position | null {
  const normalized = normalizeText(value);

  if (
    normalized === 'v' ||
    normalized.startsWith('goal') ||
    normalized.startsWith('varts')
  ) {
    return 'V';
  }
  if (
    normalized === 'a' ||
    normalized.startsWith('def') ||
    normalized.startsWith('aizs')
  ) {
    return 'A';
  }
  if (
    normalized === 'u' ||
    normalized.startsWith('att') ||
    normalized.startsWith('for') ||
    normalized.startsWith('uzbruc')
  ) {
    return 'U';
  }

  if (normalized === 'd') {
    return 'A';
  }

  return null;
}

export function listTableHeaderRows($: CheerioAPI): string[][] {
  const tables = $('table').toArray() as Element[];
  return tables
    .map((table) => getHeaderTexts($, table))
    .filter((headers) => headers.length > 0);
}

function getHeaderTexts($: CheerioAPI, table: Element): string[] {
  const headerRow = findHeaderRow($, table);
  if (!headerRow) {
    return [];
  }
  return headerRow.map((header) => cleanText($(header).text()));
}

function findHeaderRow($: CheerioAPI, table: Element): Element[] | null {
  const headerRows = $(table).find('tr').toArray() as Element[];

  for (const row of headerRows) {
    const headers = $(row).find('th').toArray() as Element[];
    if (headers.length > 0) {
      return headers;
    }
  }

  return null;
}

function resolveHeaderKey(text: string): HeaderKey | null {
  if (!text) {
    return null;
  }

  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }

  if (normalized === '%') {
    return 'save_pct';
  }

  const alias = HEADER_ALIASES[normalized];
  if (alias) {
    return alias;
  }

  if (
    normalized.includes('price') ||
    normalized.includes('cena') ||
    normalized.includes('value')
  ) {
    if (FINAL_PRICE_TOKENS.some((token) => normalized.includes(token))) {
      return 'price_final';
    }
    if (RAW_PRICE_TOKENS.some((token) => normalized.includes(token))) {
      return 'price_raw';
    }
    return normalized.includes('fantasy') ? 'price_final' : 'price_raw';
  }

  for (const matcher of KEYWORD_MATCHERS) {
    if (matchesKeywords(normalized, matcher.keywords)) {
      return matcher.key;
    }
  }

  return null;
}

function matchesKeywords(normalized: string, keywords: string[]): boolean {
  const condensed = normalized.replace(/\s+/g, '');
  const tokens = normalized.split(' ');

  return keywords.some((keyword) => {
    const normalizedKeyword = keyword.toLowerCase();
    return (
      normalized.includes(normalizedKeyword) ||
      condensed.includes(normalizedKeyword.replace(/\s+/g, '')) ||
      tokens.some((token) => token.startsWith(normalizedKeyword))
    );
  });
}

function includesAny(recognized: Set<HeaderKey>, candidates: HeaderKey[]): boolean {
  if (candidates.length === 0) {
    return true;
  }
  return candidates.some((header) => recognized.has(header));
}

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase('lv')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
}

type GoalieHeaderKey =
  | 'name'
  | 'team'
  | 'games'
  | 'saves'
  | 'save_pct'
  | 'pen_min'
  | 'shots'
  | 'goal_against';

function matchGoalieHeaderKey(value: string): GoalieHeaderKey | null {
  const normalized = normalizeForMatch(value);

  if (/vartsargs|vards|speletajs|name/.test(normalized)) {
    return 'name';
  }
  if (/komanda|team/.test(normalized)) {
    return 'team';
  }
  if (/speles/.test(normalized) || normalized === 'g' || normalized === 'sp') {
    return 'games';
  }
  if (/atvairiti|saves/.test(normalized)) {
    return 'saves';
  }
  if (/atvairito%?|%|proc|procent/.test(normalized)) {
    return 'save_pct';
  }
  if (/sodiminutes|sodamin|sodaminutes|sodimin|soda ?min|sodi|min\b|pim/.test(normalized)) {
    return 'pen_min';
  }
  if (/metieni|shots/.test(normalized)) {
    return 'shots';
  }
  if (/ielaisti|goalsagainst/.test(normalized) || normalized === 'ga') {
    return 'goal_against';
  }

  return null;
}

function goalieGoalKeyToHeaderKey(key: GoalieHeaderKey | null): HeaderKey | null {
  if (!key) return null;
  switch (key) {
    case 'name':
    case 'team':
    case 'games':
    case 'saves':
    case 'save_pct':
    case 'pen_min':
      return key;
    default:
      return null;
  }
}

function includesRequiredHeaders(recognized: Set<HeaderKey>, required: HeaderKey[]): boolean {
  if (required.length === 0) {
    return true;
  }

  const mandatory = required.filter(
    (key) => key !== 'saves' && key !== 'save_pct',
  ) as HeaderKey[];
  if (!mandatory.every((key) => recognized.has(key))) {
    return false;
  }

  if (required.includes('saves') || required.includes('save_pct')) {
    const hasTeam = recognized.has('team');
    const hasGames = recognized.has('games');
    const hasSaves = recognized.has('saves');
    const hasSavePct = recognized.has('save_pct');
    if (!(hasTeam && hasGames && (hasSaves || hasSavePct))) {
      return false;
    }
  }

  return true;
}

function normalizeForMatch(value: string): string {
  return value
    .toLocaleLowerCase('lv')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectHeaderKey(text: string): HeaderKey | null {
  return resolveHeaderKey(text) ?? goalieGoalKeyToHeaderKey(matchGoalieHeaderKey(text));
}
