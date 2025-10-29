import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnv, getEnv } from './config.js';
import { parseMatch } from './parseMatch.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const cacheDir = resolve(moduleDir, '..', '.cache');

async function findLatestMatchHtml(): Promise<{ path: string; name: string }> {
  const entries = await readdir(cacheDir);
  const htmlFiles = entries
    .filter(name => name.endsWith('.html') && !name.toLowerCase().includes('schedule'));

  if (!htmlFiles.length) {
    throw new Error(`No cached match HTML files found in ${cacheDir}`);
  }

  let latestFile = htmlFiles[0];
  let latestMtime = 0;

  for (const name of htmlFiles) {
    const filePath = resolve(cacheDir, name);
    const fileStat = await stat(filePath);
    if (fileStat.mtimeMs > latestMtime) {
      latestMtime = fileStat.mtimeMs;
      latestFile = name;
    }
  }

  return {
    path: resolve(cacheDir, latestFile),
    name: latestFile,
  };
}

async function main() {
  loadEnv();
  const baseUrl = getEnv('LFS_MATCH_URL', { optional: true }) || 'https://example.com/match';

  const latest = await findLatestMatchHtml();
  const html = await readFile(latest.path, 'utf-8');

  const parsed = await parseMatch(html, baseUrl);
  const outputName = `${parsed.match.external_id || latest.name.replace(/\.html$/, '')}.json`;
  const outputPath = resolve(cacheDir, outputName);

  await writeFile(outputPath, JSON.stringify(parsed, null, 2), 'utf-8');

  console.log(`Parsed match saved to ${outputPath}`);
  console.log(
    `Teams: ${parsed.teams.length}, Players: ${parsed.players.length}, Events: ${parsed.events.length}`
  );
}

const isDirectRun =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectRun) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
