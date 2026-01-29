import { useCallback, useEffect, useState } from 'react';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { getSupabaseEnv } from '../lib/supabaseClient';

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
    setLoading(true);
    setError(null);
    try {
      const { url, anon } = getSupabaseEnv();
      const requestUrl = `${url}/rest/v1/leaderboard?select=user_id,nickname,total_points&order=total_points.desc.nullslast&limit=3`;
      const { ok, status, json, text } = await fetchWithTimeout<LeaderboardUser[]>(
        requestUrl,
        {
          headers: {
            apikey: anon,
            Authorization: `Bearer ${anon}`,
            Accept: 'application/json',
          },
        },
        15_000,
        '[leaderboard top3]'
      );
      if (!ok) {
        throw new Error(`HTTP ${status} ${text}`);
      }
      setRows(Array.isArray(json) ? json : []);
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
