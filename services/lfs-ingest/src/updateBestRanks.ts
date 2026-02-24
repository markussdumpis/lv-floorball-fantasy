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

  const { data, error } = await client.rpc('update_best_ranks');
  if (error) {
    console.error('[update:best-ranks] rpc error', error);
    process.exit(1);
  }

  const updatedRows = Array.isArray(data) ? data[0]?.updated_rows ?? 0 : 0;
  console.log('[update:best-ranks] updated rows', updatedRows);
}

main().catch((err) => {
  console.error('[update:best-ranks] fatal', err);
  process.exit(1);
});
