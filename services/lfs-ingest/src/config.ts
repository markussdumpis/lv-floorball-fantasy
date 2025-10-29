import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

let envLoaded = false;

export function loadEnv(): void {
  if (envLoaded) return;
  loadDotenv({
    path: resolve(process.cwd(), '.env'),
  });
  envLoaded = true;
}

export function getEnv(key: string, options?: { optional?: boolean }): string {
  loadEnv();
  const value = process.env[key];
  if (value && value.trim()) {
    return value.trim();
  }
  if (options?.optional) {
    return '';
  }
  throw new Error(`Missing required environment variable: ${key}`);
}
