import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

export function usePlayers(pageSize: number = 20) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const fetchPlayers = async (pageNum: number, append: boolean = false) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);
    
    const { data: fetchedData, error } = await supabase
      .from('public_players')
      .select('id, name, position, team, price, fppg')
      .order('price', { ascending: false })
      .range(pageNum * pageSize, (pageNum + 1) * pageSize - 1);
    
    if (error) {
      setError(error.message);
    } else {
      const newData = fetchedData ?? [];
      if (append) {
        setData(prev => [...prev, ...newData]);
      } else {
        setData(newData);
      }
      setHasMore(newData.length === pageSize);
    }
    
    if (append) {
      setLoadingMore(false);
    } else {
      setLoading(false);
    }
  };

  const loadMore = useCallback(() => {
    if (!loadingMore && hasMore && !loading) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchPlayers(nextPage, true);
    }
  }, [page, loadingMore, hasMore, loading, pageSize]);

  const refetch = useCallback(() => {
    setPage(0);
    setData([]);
    setHasMore(true);
    fetchPlayers(0, false);
  }, [pageSize]);

  useEffect(() => {
    fetchPlayers(0, false);
  }, [pageSize]);

  return { data, loading, loadingMore, error, refetch, loadMore, hasMore };
}
