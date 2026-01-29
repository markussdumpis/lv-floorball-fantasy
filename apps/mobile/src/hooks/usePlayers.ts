import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { getSupabaseEnv, missingConfigMessage } from '../lib/supabaseClient';
import type { Position } from '../constants/fantasyRules';
import type { Player } from '../types/Player';

export type PlayerFilters = {
  search?: string;
  position?: Position | 'ALL';
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
      setLoading(true);
      setError(null);
      try {
        const { url, anon } = getSupabaseEnv();
        if (reset) pageRef.current = 0;
        const currentPage = pageRef.current;
        const from = currentPage * pageSize;
        const to = from + pageSize - 1;

        const params: string[] = [
          'select=id,name,position,team,price,price_final,fantasy_total,fantasy_ppg',
        ];

        if (filters.search && filters.search.trim()) {
          const s = filters.search.trim();
          params.push(`name=ilike.${encodeURIComponent(`%${s}%`)}`);
        }
        if (filters.position && filters.position !== 'ALL') {
          const rawPositions =
            filters.position === 'A'
              ? ['U']
              : filters.position === 'D'
              ? ['A']
              : [filters.position];
          params.push(`position=in.(${rawPositions.join(',')})`);
        }
        if (filters.team && filters.team !== 'ALL') {
          params.push(`team=eq.${encodeURIComponent(filters.team)}`);
        }

        const orderParam =
          filters.sort === 'price_asc'
            ? 'price.asc'
            : filters.sort === 'price_desc'
            ? 'price.desc'
            : filters.sort === 'name_desc'
            ? 'name.desc'
            : 'name.asc';
        params.push(`order=${encodeURIComponent(orderParam)}`);

        const requestUrl = `${url}/rest/v1/public_players?${params.join('&')}`;

        const { ok, status, json, headers } = await fetchWithTimeout<Player[]>(
          requestUrl,
          {
            headers: {
              apikey: anon,
              Authorization: `Bearer ${anon}`,
              Accept: 'application/json',
              Prefer: 'count=exact',
              Range: `${from}-${to}`,
            },
          },
          15_000,
          '[players]'
        );

        if (!ok) {
          throw new Error(`HTTP ${status}`);
        }

        const rows = Array.isArray(json) ? json : [];
        const nextRows = rows.map(row => ({
          ...row,
          price: row.price ?? null,
          price_final: row.price_final ?? row.price ?? null,
          pointsTotal: (row as any).fantasy_total ?? 0,
          ppg: (row as any).fantasy_ppg ?? 0,
        }));
        setData(prev => (reset ? nextRows : [...prev, ...nextRows]));
        const contentRange = headers.get('content-range');
        const total = contentRange?.split('/')?.[1];
        const totalCount = total ? Number(total) : null;
        setHasMore(totalCount !== null ? to + 1 < totalCount : nextRows.length === pageSize);
        pageRef.current = currentPage + 1;
      } catch (e: any) {
        if (e?.message?.includes('Supabase environment')) {
          setError(missingConfigMessage);
        } else {
          setError(e.message ?? 'Failed to load players');
        }
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
    try {
      const { url, anon } = getSupabaseEnv();
      const { ok, json } = await fetchWithTimeout<{ team: string | null }[]>(
        `${url}/rest/v1/players?select=team&team=not.is.null&order=team.asc`,
        {
          headers: {
            apikey: anon,
            Authorization: `Bearer ${anon}`,
            Accept: 'application/json',
          },
        },
        15_000,
        '[players teams]'
      );
      if (!ok) throw new Error('Failed to load teams');
      const unique = Array.from(
        new Set(((Array.isArray(json) ? json : []).map(row => row.team).filter(Boolean) as string[]))
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
