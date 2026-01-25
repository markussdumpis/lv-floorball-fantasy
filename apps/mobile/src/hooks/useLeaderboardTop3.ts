import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

export type LeaderboardUser = {
  user_id: string;
  nickname: string | null;
  total_points: number | null;
};

export function useLeaderboardTop3() {
  const [rows, setRows] = useState<LeaderboardUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setError('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const supabase = getSupabaseClient();
      const { data, error: err } = await supabase
        .from('leaderboard')
        .select('user_id,nickname,total_points')
        .order('total_points', { ascending: false, nullsLast: true })
        .limit(3);
      if (err) throw err;
      setRows(data ?? []);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  return { rows, loading, error, refresh: fetchLeaderboard };
}
