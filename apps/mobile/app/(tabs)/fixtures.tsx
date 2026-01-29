import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import dayjs from 'dayjs';
import { AppBackground } from '../../src/components/AppBackground';
import { fetchJson } from '../../src/lib/supabaseRest';

type TeamRef = {
  id?: string;
  code?: string | null;
  name?: string | null;
  logo_url?: string | null;
};

type Fixture = {
  id: string;
  date: string | null;
  status: string | null;
  matchweek_number: number | null;
  home?: TeamRef | null;
  away?: TeamRef | null;
};

export default function FixturesScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Fixture[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const select =
        'id,date,status,matchweek_number,home:teams!matches_home_team_fkey(id,code,name,logo_url),away:teams!matches_away_team_fkey(id,code,name,logo_url)';
      const { data } = await fetchJson<Fixture[]>('/rest/v1/matches_with_matchweek', {
        query: {
          select,
          status: 'eq.scheduled',
          order: 'date.asc',
        },
        timeoutMs: 12000,
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load fixtures');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sections = useMemo(() => {
    const byGw = new Map<number, Fixture[]>();
    rows.forEach(r => {
      const gw = r.matchweek_number ?? -1;
      if (!byGw.has(gw)) byGw.set(gw, []);
      byGw.get(gw)!.push(r);
    });
    return Array.from(byGw.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([gw, list]) => ({
        gw,
        list: list.sort((a, b) => new Date(a.date ?? 0).getTime() - new Date(b.date ?? 0).getTime()),
      }));
  }, [rows]);

  const renderRow = (fixture: Fixture) => {
    const dateText = fixture.date ? dayjs(fixture.date).format('DD MMM, HH:mm') : 'TBD';
    return (
      <View style={styles.matchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.matchTeams}>
            {(fixture.home?.code ?? fixture.home?.name ?? 'Home')} vs {(fixture.away?.code ?? fixture.away?.name ?? 'Away')}
          </Text>
          <Text style={styles.matchDate}>{dateText}</Text>
        </View>
        <Text style={styles.matchStatus}>{fixture.status ?? ''}</Text>
      </View>
    );
  };

  return (
    <AppBackground variant="home">
      <View style={styles.screen}>
        <Text style={styles.title}>Fixtures</Text>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
            <Text style={styles.muted}>Loading fixtures…</Text>
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.error}>{error}</Text>
            <Pressable style={styles.retry} onPress={load}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.muted}>No upcoming matches</Text>
          </View>
        ) : (
          <FlatList
            data={sections}
            keyExtractor={item => `gw-${item.gw}`}
            renderItem={({ item }) => (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>GW {item.gw}</Text>
                {item.list.map(f => (
                  <View key={f.id} style={styles.sectionRow}>
                    {renderRow(f)}
                  </View>
                ))}
              </View>
            )}
            ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
            contentContainerStyle={{ paddingBottom: 24 }}
            ListFooterComponent={<View style={{ height: 8 }} />}
          />
        )}
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: 16,
    gap: 12,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 4,
  },
  center: {
    marginTop: 32,
    alignItems: 'center',
    gap: 8,
  },
  muted: {
    color: '#94A3B8',
  },
  error: {
    color: '#FCA5A5',
    textAlign: 'center',
  },
  retry: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  retryText: {
    color: '#E2E8F0',
    fontWeight: '700',
  },
  section: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  sectionTitle: {
    color: '#E2E8F0',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
  },
  sectionRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  matchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  matchTeams: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  matchDate: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  matchStatus: {
    color: '#38BDF8',
    fontWeight: '700',
  },
});
