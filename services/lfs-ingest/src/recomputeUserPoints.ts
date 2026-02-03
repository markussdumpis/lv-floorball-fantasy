import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  const client = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const season = process.argv[2] || '2025-26';

  console.log('[recompute:user-points] season', season);
  const { error, data } = await client.rpc('recompute_user_season_points', {
    target_season: season,
  });
  if (error) {
    console.error('[recompute:user-points] rpc error', error);
    process.exit(1);
  }
  console.log('[recompute:user-points] done', data ?? null);
}

main().catch((err) => {
  console.error('[recompute:user-points] fatal', err);
  process.exit(1);
});
