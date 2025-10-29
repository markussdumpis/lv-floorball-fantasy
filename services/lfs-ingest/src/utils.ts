import { readdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeName as normalizeNameBase } from './utils/normalizer.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const cacheDir = resolve(moduleDir, '..', '.cache');

export function normalizeName(value: string): string {
  return normalizeNameBase(value ?? '');
}

export function toSeconds(input: number | string | null | undefined): number | null {
  if (input === null || input === undefined) return null;

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return input >= 1000 ? Math.round(input) : Math.round(input * 60);
  }

  const trimmed = input.trim();
  if (!trimmed) return null;

  const clockMatch = trimmed.match(/^(?<min>\d{1,3}):(?<sec>\d{2})$/);
  if (clockMatch?.groups) {
    const minutes = Number.parseInt(clockMatch.groups.min, 10);
    const seconds = Number.parseInt(clockMatch.groups.sec, 10);
    if (Number.isNaN(minutes) || Number.isNaN(seconds)) {
      return null;
    }
    return minutes * 60 + seconds;
  }

  const minuteMatch = trimmed.match(/^(\d{1,3})$/);
  if (minuteMatch) {
    const minutes = Number.parseInt(minuteMatch[1], 10);
    if (Number.isNaN(minutes)) return null;
    return minutes * 60;
  }

  return null;
}

export async function getLatestJsonPath(): Promise<string> {
  const entries = await readdir(cacheDir).catch(() => []);
  const candidates = entries
    .filter(name => name.toLowerCase().endsWith('.json'))
    .map(name => resolve(cacheDir, name));

  if (!candidates.length) {
    throw new Error(`No cached match JSON files found in ${cacheDir}`);
  }

  let latestPath = candidates[0];
  let latestMtime = 0;

  for (const path of candidates) {
    const fileStat = await stat(path);
    if (fileStat.mtimeMs > latestMtime) {
      latestMtime = fileStat.mtimeMs;
      latestPath = path;
    }
  }

  return latestPath;
}
