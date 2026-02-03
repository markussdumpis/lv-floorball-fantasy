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
  console.log('[recompute:user-points] user_season_points is a view; skipping recompute and verifying read access');

  const { error, count } = await client
    .from('user_season_points')
    .select('*', { count: 'exact', head: true });
  if (error) {
    console.error('[recompute:user-points] view read error', error);
    process.exit(1);
  }
  console.log('[recompute:user-points] view row count', count ?? 0);
}

main().catch((err) => {
  console.error('[recompute:user-points] fatal', err);
  process.exit(1);
});
