import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppBackground } from '../../../src/components/AppBackground';
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

type SeasonDisplayRow = {
  pen_min: number | null;
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
  const positionCode = positionParam ? String(positionParam).toUpperCase() : '';
  const isGoalie = positionCode === 'V';
  const insets = useSafeAreaInsets();

  // Sync displayed name when navigating between players via params.
  useEffect(() => {
    if (nameParam) {
      setPlayerName(decodeURIComponent(String(nameParam)));
    }
  }, [nameParam, playerId]);

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
        const seasonPimUrl = `${url}/rest/v1/player_season_points_view_display?select=pen_min&player_id=eq.${playerId}&season=eq.${CURRENT_SEASON}&limit=1`;

        console.log(`${LOG_PREFIX} fetch start playerId=${playerId} hasToken=${hasToken} url=${requestUrl}`);
        let rows: MatchRow[] = [];
        let seasonPim: number | null = null;
        try {
          const [response, seasonResponse] = await Promise.all([
            fetch(requestUrl, {
              headers,
              signal: controller.signal,
            }),
            fetch(seasonPimUrl, {
              headers,
              signal: controller.signal,
            }),
          ]);
          const status = response.status;
          console.log(`${LOG_PREFIX} status=${status}`);
          const text = await response.text();
          if (!response.ok) {
            console.error(`${LOG_PREFIX} body=${text.slice(0, 200)}`);
            throw new Error(`HTTP ${status}`);
          }
          rows = text ? (JSON.parse(text) as MatchRow[]) : [];

          const seasonStatus = seasonResponse.status;
          if (seasonResponse.ok) {
            const seasonText = await seasonResponse.text();
            const seasonRows = seasonText ? (JSON.parse(seasonText) as SeasonDisplayRow[]) : [];
            const row = Array.isArray(seasonRows) ? seasonRows[0] : null;
            seasonPim = row?.pen_min ?? null;
          } else {
            const seasonErrText = await seasonResponse.text();
            console.warn(`${LOG_PREFIX} season PIM fetch failed status=${seasonStatus} body=${seasonErrText.slice(0, 160)}`);
          }
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
        if (seasonPim !== null && Number.isFinite(Number(seasonPim))) {
          summed.pen_min = Number(seasonPim);
        }
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
      <AppBackground variant="home">
        <ScrollView contentContainerStyle={[styles.container, { paddingTop: (insets.top || 0) + 16 }]}>
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
              <View style={[styles.glassCard, styles.card]}>
                <View style={styles.headerRow}>
                  <View style={styles.nameRow}>
                    <Text style={styles.heading} numberOfLines={1} ellipsizeMode="tail">
                      {playerName}
                    </Text>
                  </View>
                </View>
                {chunkStats(
                  buildStatItems({
                    totals,
                    isGoalie,
                  }),
                  3,
                ).map((rowItems, idx) => (
                  <View key={idx} style={styles.row}>
                    {rowItems.map(item => (
                      <Stat key={item.label} label={item.label} value={item.value} bold={item.bold} primary={item.primary} />
                    ))}
                  </View>
                ))}
                <Text style={styles.meta} numberOfLines={1} ellipsizeMode="tail">
                  Season: {CURRENT_SEASON}
                </Text>
                {positionCode ? (
                  <View style={styles.positionBadge}>
                    <Text style={styles.positionBadgeText}>{positionCode}</Text>
                  </View>
                ) : null}
              </View>

              <Section title="Last match">
                {lastMatch ? <MatchRowView row={lastMatch} isGoalie={isGoalie} /> : <EmptyState text="No finished matches yet." />}
              </Section>

              <Section title="Last 5 matches">
                {recentMatches.length ? (
                  recentMatches.slice(0, 5).map(row => <MatchRowView key={row.match_id} row={row} isGoalie={isGoalie} />)
                ) : (
                  <EmptyState text="No match history." />
                )}
              </Section>
            </>
          )}
        </ScrollView>
      </AppBackground>
    </>
  );
}

function Stat({
  label,
  value,
  bold,
  primary,
}: {
  label: string;
  value: number | string;
  bold?: boolean;
  primary?: boolean;
}) {
  return (
    <View style={styles.stat}>
      <Text
        style={[
          styles.statValue,
          bold ? styles.statValueBold : null,
          primary ? styles.statValuePrimary : null,
        ]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {value}
      </Text>
      <Text style={styles.statLabel} numberOfLines={1} ellipsizeMode="tail">
        {label}
      </Text>
    </View>
  );
}

function buildStatItems({ totals, isGoalie }: { totals: Totals; isGoalie: boolean }) {
  const items = [
    { label: 'Fantasy Pts', value: totals.points.toFixed(1), bold: true, primary: true },
    ...(isGoalie
      ? [
          { label: 'SV', value: totals.saves },
          { label: 'GA', value: totals.goals_against },
          { label: 'PIM', value: totals.pen_min },
        ]
      : [
          { label: 'G', value: totals.goals },
          { label: 'A', value: totals.assists },
          { label: 'PIM', value: totals.pen_min },
        ]),
  ];
  return items;
}

function chunkStats<T>(arr: T[], size: number) {
  const rows: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    rows.push(arr.slice(i, i + size));
  }
  return rows;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={[styles.glassCard, styles.section]}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function MatchRowView({ row, isGoalie }: { row: MatchRow; isGoalie: boolean }) {
  const dateText = row.match_date ? new Date(row.match_date).toLocaleDateString() : 'Date unknown';
  const points = Number(row.points ?? 0);
  const statParts: string[] = [];
  if (isGoalie) {
    if (row.saves || row.saves === 0) statParts.push(`${row.saves ?? 0} SV`);
    if (row.goals_against || row.goals_against === 0) statParts.push(`${row.goals_against ?? 0} GA`);
  } else {
    if (row.goals || row.goals === 0) statParts.push(`${row.goals ?? 0} G`);
    if (row.assists || row.assists === 0) statParts.push(`${row.assists ?? 0} A`);
  }
  const statLine = statParts.length ? statParts.join(' • ') : 'No stats';

  return (
    <View style={styles.matchRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.matchTitle} numberOfLines={1} ellipsizeMode="tail">
          {dateText}
        </Text>
        <Text style={styles.matchSubtitle} numberOfLines={1} ellipsizeMode="tail">
          {row.opponent_team_name ? `vs ${row.opponent_team_name}` : ''}
        </Text>
        <Text style={styles.matchStats} numberOfLines={1} ellipsizeMode="tail">
          {statLine}
        </Text>
      </View>
      <Text
        style={[
          styles.matchPoints,
          points < 0 ? styles.matchPointsNegative : styles.matchPointsPositive,
        ]}
        numberOfLines={1}
        ellipsizeMode="clip"
      >
        {points.toFixed(1)}
      </Text>
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
  glassCard: {
    backgroundColor: 'rgba(8, 15, 30, 0.72)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 7,
  },
  card: {
    padding: 16,
    gap: 8,
  },
  positionBadge: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.2,
    borderColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  positionBadgeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  heading: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  positionTag: {
    color: '#c7d2fe',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.3,
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
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  statValueBold: {
    fontSize: 20,
  },
  statValuePrimary: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f8fafc',
  },
  statLabel: {
    color: '#9ca3af',
    fontSize: 12,
    letterSpacing: 0.3,
  },
  meta: {
    color: '#9ca3af',
    fontSize: 12,
    letterSpacing: 0.2,
  },
  section: {
    padding: 12,
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
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  matchTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  matchSubtitle: {
    color: 'rgba(255, 255, 255, 0.62)',
    fontSize: 12,
    marginTop: 1,
  },
  matchStats: {
    color: 'rgba(255, 255, 255, 0.48)',
    fontSize: 12,
    marginTop: 3,
  },
  matchMeta: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
  },
  matchPoints: {
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 12,
    minWidth: 48,
    textAlign: 'right',
  },
  matchPointsPositive: {
    color: '#22d3ee',
  },
  matchPointsNegative: {
    color: 'rgba(255, 110, 110, 0.9)',
  },
  empty: {
    paddingVertical: 8,
  },
  emptyText: {
    color: '#9ca3af',
  },
});
