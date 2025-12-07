import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { EnvConfig } from './env.js';
import type { PlayerSeasonStatsRow } from './types.js';

export interface SupabaseServices {
  client: SupabaseClient;
  clearPlayerStatsStaging(): Promise<void>;
  insertPlayerSeasonStats(rows: PlayerSeasonStatsRow[]): Promise<number>;
}

export function createSupabase(env: EnvConfig): SupabaseServices {
  const client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  async function clearPlayerStatsStaging(): Promise<void> {
    const { error } = await client
      .from('players_stats_staging')
      // Delete all rows; PostgREST requires a filter so we target non-null names (all ingest rows have one).
      .delete()
      .not('name', 'is', null);

    if (error) {
      throw error;
    }
  }

  async function insertPlayerSeasonStats(rows: PlayerSeasonStatsRow[]): Promise<number> {
    if (!rows.length) {
      return 0;
    }

    const { error, count } = await client
      .from('players_stats_staging')
      .insert(rows, { count: 'exact' });

    if (error) {
      throw error;
    }

    return count ?? rows.length;
  }

  return {
    client,
    clearPlayerStatsStaging,
    insertPlayerSeasonStats,
  };
}
