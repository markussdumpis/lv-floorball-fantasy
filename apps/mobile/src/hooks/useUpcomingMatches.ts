import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

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
    if (!isSupabaseConfigured()) {
      setError(
        'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.'
      );
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const supabase = getSupabaseClient();
      const nowIso = new Date().toISOString();

      let query = supabase
        .from('matches')
        .select(selectColumns)
        .gte('date', nowIso)
        .order('date', { ascending: true })
        .limit(10);

      if (STATUS_FILTERS.length) {
        query = query.in('status', STATUS_FILTERS);
      }

      const { data, error: queryError } = await query;
      if (queryError) {
        const looksLikeJoinError = /relationship|foreign|join|column/i.test(queryError.message ?? '');
        const joinHint = looksLikeJoinError
          ? "select('id, date, status, home_team:teams!matches_home_team_fkey(name), away_team:teams!matches_away_team_fkey(name)')"
          : null;
        const message = joinHint
          ? `${queryError.message} | Try: ${joinHint}`
          : queryError.message ?? 'Failed to load upcoming matches';
        setError(message);
        console.error('Failed to load upcoming matches', queryError);
        return;
      }

      setMatches((data ?? []) as UpcomingMatch[]);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load upcoming matches');
      console.error('Failed to load upcoming matches', e);
    } finally {
      setLoading(false);
    }
  }, [selectColumns]);

  useEffect(() => {
    fetchMatches();
  }, [fetchMatches]);

  return { matches, loading, error } as const;
}
