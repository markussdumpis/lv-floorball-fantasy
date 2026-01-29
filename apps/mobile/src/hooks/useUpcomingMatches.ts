import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseEnv } from '../lib/supabaseClient';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';

export type UpcomingMatch = {
  id: string;
  date: string;
  status: string | null;
  home: { id: string; code: string | null; logo_url: string | null } | null;
  away: { id: string; code: string | null; logo_url: string | null } | null;
};

const STATUS_FILTERS = ['scheduled', 'upcoming'];

/**
 * Load upcoming matches with team names. Uses Supabase join syntax to resolve team references.
 */
export function useUpcomingMatches() {
  const [matches, setMatches] = useState<UpcomingMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatError = (err: { message?: string; code?: string } | null | undefined) => {
    if (!err) return 'Unknown error';
    const message = err.message ?? 'Unknown error';
    return err.code ? `${message} | code=${err.code}` : message;
  };

  const selectColumns = useMemo(
    () =>
      [
        'id',
        'date',
        'status',
        'home:teams!matches_home_team_fkey (id, code, logo_url)',
        'away:teams!matches_away_team_fkey (id, code, logo_url)',
      ].join(', '),
    []
  );

  const fetchMatches = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { url, anon } = getSupabaseEnv();
      const nowIso = new Date().toISOString();
      const select = encodeURIComponent(selectColumns);
      const statusFilter = STATUS_FILTERS.length
        ? `&status=in.(${STATUS_FILTERS.join(',')})`
        : '';
      const requestUrl = `${url}/rest/v1/matches?select=${select}&date=gte.${encodeURIComponent(
        nowIso
      )}${statusFilter}&order=date.asc&limit=10`;

      const { ok, status, json, text } = await fetchWithTimeout<UpcomingMatch[]>(
        requestUrl,
        {
          headers: {
            apikey: anon,
            Authorization: `Bearer ${anon}`,
            Accept: 'application/json',
          },
        },
        15_000,
        '[home matches]'
      );

      if (!ok) {
        throw new Error(`HTTP ${status} ${text}`);
      }

      setMatches(Array.isArray(json) ? json : []);
    } catch (e: any) {
      setError(formatError(e));
      console.error('[home matches] unexpected error', e);
    } finally {
      setLoading(false);
    }
  }, [selectColumns]);

  useEffect(() => {
    fetchMatches();
  }, [fetchMatches]);

  return { matches, loading, error } as const;
}
