import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { buildHeaders, getSupabaseEnv, getStoredSession } from '../../../src/lib/supabaseRest';

type MatchRow = {
  match_id: string;
  match_date: string | null;
  opponent_team_name: string | null;
  points: number | null;
  goals: number | null;
  assists: number | null;
  pen_min: number | null;
  saves: number | null;
  goals_against: number | null;
};

type Totals = {
  points: number;
  goals: number;
  assists: number;
  pen_min: number;
  saves: number;
  goals_against: number;
};

const CURRENT_SEASON = '2025-26';
const LOG_PREFIX = '[PlayerPoints]';

export default function PlayerPointsDetailsScreen() {
  const params = useLocalSearchParams<{ playerId?: string | string[]; name?: string; playerName?: string; position?: string }>();
  console.log('player-points params', params);
  const playerIdParam = params.playerId;
  const playerId = typeof playerIdParam === 'string' ? playerIdParam : '';
  const positionParam = params.position;
  const nameParam = params.name ?? params.playerName;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recentMatches, setRecentMatches] = useState<MatchRow[]>([]);
  const [totals, setTotals] = useState<Totals>({
    points: 0,
    goals: 0,
    assists: 0,
    pen_min: 0,
    saves: 0,
    goals_against: 0,
  });
  const [playerName, setPlayerName] = useState<string>(nameParam ? decodeURIComponent(String(nameParam)) : 'Player');
  const [reloadKey, setReloadKey] = useState(0);

  const lastMatch = useMemo(() => (recentMatches.length ? recentMatches[0] : null), [recentMatches]);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      if (!playerId) {
        setError('Missing player id');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        // optional name fetch (lightweight) using REST
        if (!nameParam) {
          try {
            const { url } = getSupabaseEnv();
            const headers = await buildHeaders({ requireAuth: true });
            const nameUrl = `${url}/rest/v1/players?select=name&id=eq.${playerId}&limit=1`;
            console.log(`${LOG_PREFIX} name fetch playerId=${playerId} url=${nameUrl}`);
            const nameResp = await fetch(nameUrl, { headers });
            const nameJson = nameResp.ok ? await nameResp.json() : [];
            const playerRow = Array.isArray(nameJson) ? nameJson[0] : null;
            if (playerRow?.name) setPlayerName(playerRow.name);
          } catch (nameErr) {
            console.warn(`${LOG_PREFIX} name lookup skipped`, nameErr);
          }
        }

        const { url } = getSupabaseEnv();
        const query =
          'match_id,match_date,match_status,season,opponent_team_name,points,goals,assists,pen_min,saves,goals_against';
        const requestUrl = `${url}/rest/v1/player_match_points_details_view?select=${encodeURIComponent(
          query
        )}&player_id=eq.${playerId}&season=eq.${CURRENT_SEASON}&match_status=eq.finished&order=match_date.desc`;

        const session = await getStoredSession();
        const hasToken = !!session.token;
        const headers = await buildHeaders({ requireAuth: true });
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12_000);

        console.log(`${LOG_PREFIX} fetch start playerId=${playerId} hasToken=${hasToken} url=${requestUrl}`);
        let rows: MatchRow[] = [];
        try {
          const response = await fetch(requestUrl, {
            headers,
            signal: controller.signal,
          });
          const status = response.status;
          console.log(`${LOG_PREFIX} status=${status}`);
          const text = await response.text();
          if (!response.ok) {
            console.error(`${LOG_PREFIX} body=${text.slice(0, 200)}`);
            throw new Error(`HTTP ${status}`);
          }
          rows = text ? (JSON.parse(text) as MatchRow[]) : [];
        } finally {
          clearTimeout(timeout);
        }

        if (!isMounted) return;
        const finishedRows = rows ?? [];
        setRecentMatches(finishedRows.slice(0, 5));

        const summed = finishedRows.reduce<Totals>(
          (acc, row) => ({
            points: acc.points + (Number(row.points) || 0),
            goals: acc.goals + (Number(row.goals) || 0),
            assists: acc.assists + (Number(row.assists) || 0),
            pen_min: acc.pen_min + (Number(row.pen_min) || 0),
            saves: acc.saves + (Number(row.saves) || 0),
            goals_against: acc.goals_against + (Number(row.goals_against) || 0),
          }),
          { points: 0, goals: 0, assists: 0, pen_min: 0, saves: 0, goals_against: 0 },
        );
        setTotals(summed);
      } catch (err) {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : 'Failed to load player points';
        setError(msg);
        console.error(`${LOG_PREFIX} Fatal`, err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [playerId, nameParam, reloadKey]);

  return (
    <>
      <Stack.Screen options={{ title: playerName || 'Player Points' }} />
      <ScrollView contentContainerStyle={styles.container}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.error}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => setReloadKey(key => key + 1)}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.heading}>{playerName}</Text>
              <Text style={styles.subheading}>{positionParam ? String(positionParam).toUpperCase() : ''}</Text>
              <View style={styles.row}>
                <Stat label="Fantasy Pts" value={totals.points.toFixed(1)} bold />
                <Stat label="Goals" value={totals.goals} />
                <Stat label="Assists" value={totals.assists} />
              </View>
              <View style={styles.row}>
                <Stat label="Saves" value={totals.saves} />
                <Stat label="GA" value={totals.goals_against} />
                <Stat label="PIM" value={totals.pen_min} />
              </View>
              <Text style={styles.meta}>Season: {CURRENT_SEASON}</Text>
            </View>

            <Section title="Last match">
              {lastMatch ? <MatchRowView row={lastMatch} /> : <EmptyState text="No finished matches yet." />}
            </Section>

            <Section title="Last 5 matches">
              {recentMatches.length ? (
                recentMatches.slice(0, 5).map(row => <MatchRowView key={row.match_id} row={row} />)
              ) : (
                <EmptyState text="No match history." />
              )}
            </Section>
          </>
        )}
      </ScrollView>
    </>
  );
}

function Stat({ label, value, bold }: { label: string; value: number | string; bold?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, bold ? styles.statValueBold : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function MatchRowView({ row }: { row: MatchRow }) {
  const dateText = row.match_date ? new Date(row.match_date).toLocaleDateString() : 'Date unknown';
  const points = Number(row.points ?? 0);
  const stats: string[] = [];
  if (row.goals) stats.push(`${row.goals}G`);
  if (row.assists) stats.push(`${row.assists}A`);
  if (row.saves) stats.push(`${row.saves}SV`);
  if (row.goals_against || row.goals_against === 0) stats.push(`${row.goals_against}GA`);
  if (row.pen_min) stats.push(`${row.pen_min} PIM`);

  return (
    <View style={styles.matchRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.matchTitle}>{dateText}</Text>
        <Text style={styles.matchSubtitle}>{row.opponent_team_name ? `vs ${row.opponent_team_name}` : ''}</Text>
        <Text style={styles.matchStats}>{stats.join(' · ') || 'No stats'}</Text>
      </View>
      <Text style={styles.matchPoints}>{points.toFixed(1)}</Text>
    </View>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  center: {
    marginTop: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    color: '#c00',
  },
  retryButton: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
  },
  retryText: {
    color: '#e5e7eb',
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#0b152a',
    padding: 16,
    borderRadius: 12,
  },
  heading: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  subheading: {
    color: '#a5b4fc',
    fontSize: 14,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  stat: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  statValueBold: {
    fontSize: 18,
  },
  statLabel: {
    color: '#9ca3af',
    fontSize: 12,
  },
  meta: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 8,
  },
  section: {
    backgroundColor: '#0f172a',
    padding: 12,
    borderRadius: 12,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  matchTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  matchSubtitle: {
    color: '#9ca3af',
    fontSize: 12,
  },
  matchStats: {
    color: '#cbd5e1',
    fontSize: 12,
    marginTop: 2,
  },
  matchMeta: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
  },
  matchPoints: {
    color: '#22d3ee',
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 12,
  },
  empty: {
    paddingVertical: 8,
  },
  emptyText: {
    color: '#9ca3af',
  },
});
