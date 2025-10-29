import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetch } from 'undici';
import { loadEnv, getEnv } from './config.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleDir, '..');
const cacheDir = resolve(projectRoot, '.cache');

export type ScrapeResult = {
  html: string;
  matchId: string;
  cachePath: string;
  url: string;
  cached: boolean;
};

function deriveMatchId(matchUrl: string): string {
  try {
    const url = new URL(matchUrl);
    const candidate = url.searchParams.get('id') ?? url.pathname.split('/').filter(Boolean).pop();
    if (candidate) {
      return candidate.replace(/[^a-z0-9_-]/gi, '');
    }
  } catch {
    // swallow
  }
  return `match-${Date.now()}`;
}

async function ensureCacheDir() {
  await mkdir(cacheDir, { recursive: true });
}

async function writeCache(matchId: string, html: string): Promise<string> {
  await ensureCacheDir();
  const cachePath = resolve(cacheDir, `${matchId}.html`);
  await writeFile(cachePath, html, 'utf-8');
  return cachePath;
}

export async function readCache(matchId: string): Promise<string> {
  const cachePath = resolve(cacheDir, `${matchId}.html`);
  return readFile(cachePath, 'utf-8');
}

export async function scrape(matchUrl?: string, options?: { force?: boolean }): Promise<ScrapeResult> {
  loadEnv();
  const url = matchUrl ?? getEnv('LFS_MATCH_URL');
  const matchId = deriveMatchId(url);
  const cachePath = resolve(cacheDir, `${matchId}.html`);

  if (!options?.force) {
    try {
      const cachedHtml = await readFile(cachePath, 'utf-8');
      return {
        html: cachedHtml,
        matchId,
        cachePath,
        url,
        cached: true,
      };
    } catch {
      // cache miss, continue
    }
  }

  const response = await fetch(url, {
    headers: {
      'user-agent': 'lv-floorball-fantasy-ingest/1.0 (+https://lv-floorball-fantasy.example)',
      accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch match HTML (${response.status} ${response.statusText})`);
  }

  const html = await response.text();
  const savedPath = await writeCache(matchId, html);

  return {
    html,
    matchId,
    cachePath: savedPath,
    url,
    cached: false,
  };
}

async function runCli() {
  const urlArg = process.argv[2];
  const force = process.argv.includes('--force');
  const result = await scrape(urlArg, { force });
  const prefix = result.cached ? 'Loaded cached HTML' : 'Fetched and cached HTML';
  console.log(`${prefix} for match ${result.matchId}`);
  console.log(`Cache path: ${result.cachePath}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runCli().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
