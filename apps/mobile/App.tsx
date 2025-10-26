import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { supabase } from './src/lib/supabaseClient';

export default function App() {
  const [players, setPlayers] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('players')
        .select('*')
        .order('price', { ascending: false })
        .limit(10);
      if (error) setError(error.message);
      else setPlayers(data ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <ScrollView contentContainerStyle={{ padding: 20 }}>
      <Text style={{ fontWeight: 'bold', fontSize: 20, marginBottom: 12 }}>
        Latvian Floorball Players
      </Text>
      {loading && <Text>Loading...</Text>}
      {error && <Text style={{ color: 'red' }}>Error: {error}</Text>}
      {!loading && !error && players.length === 0 && <Text>No players found.</Text>}
      {players.map((p) => (
        <Text key={p.id}>
          {p.name} — {p.position} — {p.price}
        </Text>
      ))}
    </ScrollView>
  );
}

