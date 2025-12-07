import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.cache');

export async function saveDebugResponse(filename: string, raw: string): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(join(CACHE_DIR, filename), raw, 'utf8');
  } catch (error) {
    console.warn(`[debug] Failed to write ${filename}`, error);
  }
}
