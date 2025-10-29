import { pathToFileURL } from 'node:url';
import { loadEnv, getEnv } from './config.js';
import { scrape } from './scrape.js';
import { parse } from './parse.js';
import { importToSupabase } from './import.js';

async function main() {
  loadEnv();
  const urlFromEnv = process.env.LFS_MATCH_URL?.trim() || getEnv('LFS_MATCH_URL');
  const force = process.argv.includes('--force');

  const scrapeResult = await scrape(urlFromEnv, { force });
  console.log(
    `${scrapeResult.cached ? 'Using cached' : 'Fetched'} HTML for match ${scrapeResult.matchId}`
  );

  const document = parse(scrapeResult.html, {
    matchId: scrapeResult.matchId,
    matchUrl: scrapeResult.url,
  });

  console.log(
    `Parsed match ${document.match.externalId}: ${document.teams[0]?.name} vs ${document.teams[1]?.name}`
  );
  console.log(
    `Teams: ${document.teams.length}, Players: ${document.players.length}, Events: ${document.events.length}`
  );

  await importToSupabase(document);
  console.log('Import completed successfully.');
}

const isDirectRun =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectRun) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
