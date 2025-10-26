import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export function usePlayers() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('players')
        .select('*')
        .order('price', { ascending: false });
      if (error) setError(error.message);
      else setData(data ?? []);
      setLoading(false);
    })();
  }, []);

  return { data, loading, error };
}
