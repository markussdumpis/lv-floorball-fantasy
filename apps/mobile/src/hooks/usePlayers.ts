import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import type { Player } from '../types/Player';

export type PlayerFilters = {
  search?: string;
  position?: 'F' | 'D' | 'G' | 'ALL';
  team?: string | 'ALL';
  sort?: 'name_asc' | 'name_desc' | 'price_asc' | 'price_desc';
  pageSize?: number;
};

const DEFAULT_PAGE_SIZE = 20;

export function usePlayers(initial: PlayerFilters = {}) {
  const [filters, setFiltersState] = useState<PlayerFilters>({
    position: 'ALL',
    team: 'ALL',
    sort: 'price_desc',
    ...initial,
  });
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const [data, setData] = useState<Player[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [teams, setTeams] = useState<string[]>([]);
  const debounce = useRef<NodeJS.Timeout | null>(null);
  const pageRef = useRef(0);

  const fetchPage = useCallback(
    async (reset = false) => {
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
        let q = supabase
          .from('players')
          .select('id, name, position, team, price, points_total', { count: 'exact' });

        if (filters.search && filters.search.trim()) {
          const s = filters.search.trim();
          q = q.ilike('name', `%${s}%`);
        }
        if (filters.position && filters.position !== 'ALL') {
          q = q.eq('position', filters.position);
        }
        if (filters.team && filters.team !== 'ALL') {
          q = q.eq('team', filters.team);
        }

        switch (filters.sort) {
          case 'price_asc':
            q = q.order('price', { ascending: true, nullsFirst: true });
            break;
          case 'price_desc':
            q = q.order('price', { ascending: false, nullsFirst: false });
            break;
          case 'name_desc':
            q = q.order('name', { ascending: false });
            break;
          default:
            q = q.order('name', { ascending: true });
        }

        if (reset) {
          pageRef.current = 0;
        }
        const currentPage = pageRef.current;
        const from = currentPage * pageSize;
        const to = from + pageSize - 1;

        const { data: rows, error: err, count } = await q.range(from, to);
        if (err) throw err;

        const nextRows = rows ?? [];
        setData(prev => (reset ? nextRows : [...prev, ...nextRows]));
        setHasMore(
          count !== null ? to + 1 < count : nextRows.length === pageSize
        );
        pageRef.current = currentPage + 1;
      } catch (e: any) {
        setError(e.message ?? 'Failed to load players');
      } finally {
        setLoading(false);
      }
    },
    [filters, pageSize]
  );

  const refresh = useCallback(() => {
    return fetchPage(true);
  }, [fetchPage]);

  const updateFilters = useCallback(
    (next: Partial<PlayerFilters>) => {
      setFiltersState(prev => ({
        ...prev,
        ...next,
        pageSize: next.pageSize ?? prev.pageSize,
      }));
    },
    []
  );

  const fetchTeams = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    try {
      const supabase = getSupabaseClient();
      const { data: rows, error: err } = await supabase
        .from('players')
        .select('team')
        .not('team', 'is', null)
        .order('team', { ascending: true });

      if (err) throw err;
      const unique = Array.from(
        new Set((rows ?? []).map(row => row.team).filter(Boolean) as string[])
      );
      setTeams(unique);
    } catch (e) {
      console.error('Failed to load teams filter options', e);
    }
  }, []);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => refresh(), 300);
    return () => {
      if (debounce.current) {
        clearTimeout(debounce.current);
        debounce.current = null;
      }
    };
  }, [filters.search, filters.position, filters.team, filters.sort, refresh]);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) fetchPage();
  }, [loading, hasMore, fetchPage]);

  return {
    data,
    loading,
    error,
    hasMore,
    loadMore,
    refresh,
    filters,
    setFilters: updateFilters,
    teams,
  };
}
