import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

export type LeaderboardItem = {
  user_id: string;
  nickname: string | null;
  total_points: number | null;
};

const MOCK_ROWS: LeaderboardItem[] = [
  { user_id: 'mock-1', nickname: 'Player One', total_points: 120 },
  { user_id: 'mock-2', nickname: 'Player Two', total_points: 98 },
  { user_id: 'mock-3', nickname: 'Player Three', total_points: 87 },
];

export function useLeaderboard(limit = 3) {
  const [rows, setRows] = useState<LeaderboardItem[]>(MOCK_ROWS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setError(
        'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.'
      );
      setRows(MOCK_ROWS);
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
        .limit(limit);

      if (err) throw err;
      const next = data && data.length ? data : MOCK_ROWS;
      setRows(next);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load leaderboard');
      setRows(MOCK_ROWS);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  return { rows, loading, error, refresh: fetchLeaderboard };
}
