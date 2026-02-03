import { useCallback, useEffect, useState } from 'react';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { getSupabaseEnv } from '../lib/supabaseClient';

export type LeaderboardItem = {
  user_id: string;
  nickname: string | null;
  total_points: number | null;
};

export function useLeaderboard(limit = 3) {
  const [rows, setRows] = useState<LeaderboardItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatError = (err: { message?: string; code?: string } | null | undefined) => {
    if (!err) return 'Unknown error';
    const message = err.message ?? 'Unknown error';
    return err.code ? `${message} | code=${err.code}` : message;
  };

  const fetchLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { url, anon } = getSupabaseEnv();
      const requestUrl = `${url}/rest/v1/leaderboard?select=*&order=total_points.desc&limit=${limit}`;
      console.log('[home leaderboard] request', { requestUrl });
      const { ok, status, json, text } = await fetchWithTimeout<LeaderboardItem[]>(
        requestUrl,
        {
          headers: {
            apikey: anon,
            Authorization: `Bearer ${anon}`,
            Accept: 'application/json',
          },
        },
        15_000,
        '[home leaderboard]'
      );
      if (!ok) {
        throw new Error(`HTTP ${status} ${text}`);
      }
      const rows = Array.isArray(json) ? json : [];
      console.log('[home leaderboard] response', {
        status,
        count: rows.length,
        sample: rows.slice(0, 3),
      });
      setRows(rows);
    } catch (e: any) {
      setError(formatError(e));
      console.error('[home leaderboard] unexpected error', e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  return { rows, loading, error, refresh: fetchLeaderboard };
}
