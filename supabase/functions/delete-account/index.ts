import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const authHeader = req.headers.get('Authorization');

  try {
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse(401, { error: 'Missing or invalid authorization header' });
    }
    const jwt = authHeader.replace('Bearer ', '').trim();
    if (!jwt) {
      return jsonResponse(401, { error: 'Missing JWT' });
    }

    const { data: userRes, error: userError } = await supabaseAdmin.auth.getUser(jwt);
    if (userError || !userRes.user) {
      console.error('[delete-account] auth.getUser failed', userError);
      return jsonResponse(401, { error: 'Unauthorized' });
    }
    const userId = userRes.user.id;

    if (!userId) {
      return jsonResponse(401, { error: 'Unauthorized' });
    }

    const { error: deleteDataError } = await supabaseAdmin.rpc('delete_user_data', {
      p_user_id: userId,
    });
    if (deleteDataError) {
      console.error('[delete-account] delete_user_data failed', deleteDataError);
      return jsonResponse(500, { error: deleteDataError.message ?? 'Failed to delete user data' });
    }

    const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteAuthError) {
      console.error('[delete-account] auth.admin.deleteUser failed', deleteAuthError);
      return jsonResponse(500, { error: deleteAuthError.message ?? 'Failed to delete auth user' });
    }

    return jsonResponse(200, { success: true });
  } catch (error) {
    console.error('[delete-account] unhandled error', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }
});
