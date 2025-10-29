import { createClient } from '@supabase/supabase-js';
import { getEnv, loadEnv } from './config.js';

loadEnv();

const supabaseUrl = getEnv('SUPABASE_URL');
const supabaseServiceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

export const admin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});
