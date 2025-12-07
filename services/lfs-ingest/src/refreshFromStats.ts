import { pathToFileURL } from 'node:url';
import { ingestSeasonStats } from './seedFromStats.js';

export async function refreshSeasonStats(): Promise<void> {
  await ingestSeasonStats('refresh');
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  refreshSeasonStats().catch((error) => {
    console.error('[refresh] Fatal error', error);
    process.exitCode = 1;
  });
}
