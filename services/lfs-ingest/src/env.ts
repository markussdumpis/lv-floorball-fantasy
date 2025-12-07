import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

export interface EnvConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  skatersUrl: string;
  goaliesUrl: string;
  userAgent: string;
  cookie: string;
  debugSaveHtml: boolean;
  skatersEndpoint: string;
  skatersForm: string;
  goaliesEndpoint: string;
  goaliesForm: string;
}

let cachedConfig: EnvConfig | undefined;

const REQUIRED_ENV = {
  SUPABASE_URL: 'SUPABASE_URL',
  SUPABASE_SERVICE_ROLE_KEY: 'SUPABASE_SERVICE_ROLE_KEY',
  LFS_SKATERS_URL: 'LFS_SKATERS_URL',
  LFS_GOALIES_URL: 'LFS_GOALIES_URL',
  LFS_SKATERS_ENDPOINT: 'LFS_SKATERS_ENDPOINT',
  LFS_SKATERS_FORM: 'LFS_SKATERS_FORM',
  LFS_GOALIES_ENDPOINT: 'LFS_GOALIES_ENDPOINT',
  LFS_GOALIES_FORM: 'LFS_GOALIES_FORM',
  LFS_USER_AGENT: 'LFS_USER_AGENT',
  LFS_COOKIE: 'LFS_COOKIE',
} as const;

const OPTIONAL_ENV = {
  DEBUG_SAVE_HTML: 'DEBUG_SAVE_HTML',
} as const;

const ENV_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');

function loadConfig(): EnvConfig {
  loadEnv({ path: ENV_PATH });

  const supabaseUrl = requireEnv(REQUIRED_ENV.SUPABASE_URL);
  const supabaseServiceRoleKey = requireEnv(REQUIRED_ENV.SUPABASE_SERVICE_ROLE_KEY);
  const skatersUrl = requireEnv(REQUIRED_ENV.LFS_SKATERS_URL);
  const goaliesUrl = requireEnv(REQUIRED_ENV.LFS_GOALIES_URL);
  const skatersEndpoint = requireEnv(REQUIRED_ENV.LFS_SKATERS_ENDPOINT);
  const skatersForm = requireEnv(REQUIRED_ENV.LFS_SKATERS_FORM);
  const goaliesEndpoint = requireEnv(REQUIRED_ENV.LFS_GOALIES_ENDPOINT);
  const goaliesForm = requireEnv(REQUIRED_ENV.LFS_GOALIES_FORM);
  const userAgent = requireEnv(REQUIRED_ENV.LFS_USER_AGENT);
  const cookie = requireEnv(REQUIRED_ENV.LFS_COOKIE);
  const debugSaveHtml = parseBoolean(process.env[OPTIONAL_ENV.DEBUG_SAVE_HTML]);

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
    skatersUrl,
    goaliesUrl,
    userAgent,
    cookie,
    debugSaveHtml,
    skatersEndpoint,
    skatersForm,
    goaliesEndpoint,
    goaliesForm,
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

export function getEnv(): EnvConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}
