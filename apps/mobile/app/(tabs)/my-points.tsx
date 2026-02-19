import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
} from 'react-native';
import { router } from 'expo-router';
import { fetchJson, getStoredSession } from '../../src/lib/supabaseRest';
import { AppBackground } from '../../src/components/AppBackground';

type PlayerPointsRow = {
  playerId: string;
  name: string;
  position: string | null;
  isCaptain: boolean;
  basePoints: number;
  captainBonus: number;
  totalPoints: number;
};

const LOG_PREFIX = '[MyPoints]';

export default function MyPointsScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<PlayerPointsRow[]>([]);
  const [teamName, setTeamName] = useState<string | null>(null);

  const totalPoints = useMemo(
    () => rows.reduce((sum, row) => sum + (Number.isFinite(row.totalPoints) ? row.totalPoints : 0), 0),
    [rows],
  );

  const loadPoints = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      console.log(`${LOG_PREFIX} start`);
      const { token, userId } = await getStoredSession();
      if (!token || !userId) {
        setError('Please log in');
        setRows([]);
        return;
      }
      console.log('[MyPoints] storage auth ok', { userId });
      console.log(`${LOG_PREFIX} session ok user=${userId}`);

      // Step 2: latest fantasy team (REST)
      const { data: teamRows } = await fetchJson<{ id: string; name: string | null }[]>(
        '/rest/v1/fantasy_teams',
        {
          requireAuth: true,
          query: {
            select: 'id,name',
            user_id: `eq.${userId}`,
            order: 'created_at.desc',
            limit: 1,
          },
          timeoutMs: 12_000,
        }
      );
      const team = Array.isArray(teamRows) ? teamRows[0] : null;
      if (!team?.id) {
        setError('No fantasy team found');
        setRows([]);
        return;
      }
      setTeamName(team.name ?? 'My Team');
      console.log(`${LOG_PREFIX} team ${team.id}`);

      // Step 3: points view (REST)
      const { data: pointsRows } = await fetchJson<any[]>(
        '/rest/v1/user_team_player_points_view',
        {
          requireAuth: true,
          query: {
            select:
              'player_id,name,position,is_captain,base_points,captain_bonus,total_points',
            fantasy_team_id: `eq.${team.id}`,
          },
          timeoutMs: 12_000,
        }
      );
      const rowsMapped: PlayerPointsRow[] = (pointsRows ?? [])
        .map(row => ({
          playerId: (row as any).player_id,
          name: (row as any).name ?? 'Unknown player',
          position: (row as any).position ?? null,
          isCaptain: Boolean((row as any).is_captain),
          basePoints: Number((row as any).base_points ?? 0) || 0,
          captainBonus: Number((row as any).captain_bonus ?? 0) || 0,
          totalPoints: Number((row as any).total_points ?? 0) || 0,
        }))
        .sort((a, b) => b.totalPoints - a.totalPoints);

      setRows(rowsMapped);
    } catch (err: any) {
      console.error(`${LOG_PREFIX} Unexpected error`, err);
      setError(err?.message ?? 'Unexpected error loading points.');
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadPoints();
  }, [loadPoints]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadPoints();
  }, [loadPoints]);

  const renderItem = ({ item }: { item: PlayerPointsRow }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() =>
        router.push({
          pathname: '/player-points/[playerId]',
          params: {
            playerId: item.playerId,
            name: item.name,
            position: item.position ?? undefined,
          },
        })
      }
    >
      <View style={styles.rowHeader}>
        <View style={styles.rowTitleWrap}>
          <Text style={styles.playerName} numberOfLines={1} ellipsizeMode="tail">
            {item.name}
          </Text>
          {item.isCaptain ? (
            <View style={styles.captainTag}>
              <Text style={styles.captainTagText}>C</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.pointsText}>{item.totalPoints.toFixed(2)}</Text>
      </View>
      <Text style={styles.subText}>Position: {item.position ?? 'Unknown'}</Text>
      {item.isCaptain ? (
        <Text style={styles.captainBonus}>Captain bonus: {item.captainBonus.toFixed(2)}</Text>
      ) : null}
    </TouchableOpacity>
  );

  return (
    <AppBackground variant="home">
      <View style={styles.container}>
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text style={styles.statusText}>Loading your points…</Text>
          </View>
        ) : (
          <>
            <Text style={styles.title}>{teamName ?? 'My Points'}</Text>
            <Text style={styles.totalText}>Season Total: {totalPoints.toFixed(2)}</Text>
            <Text style={styles.subheader}>Season: 2025-26</Text>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <FlatList
              data={rows}
              keyExtractor={item => item.playerId}
              renderItem={renderItem}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <Text style={styles.statusText}>No players to show. Save a squad to see points.</Text>
              }
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3B82F6" />
              }
              showsVerticalScrollIndicator={false}
            />
          </>
        )}
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 42,
    gap: 6,
  },
  loadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 40,
    gap: 10,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  totalText: {
    color: '#38BDF8',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  subheader: {
    color: '#CBD5E1',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 8,
  },
  errorText: {
    color: '#F87171',
    textAlign: 'center',
    marginBottom: 12,
  },
  statusText: {
    color: '#CBD5E1',
    textAlign: 'center',
    marginTop: 12,
  },
  listContent: {
    paddingBottom: 44,
    gap: 10,
  },
  row: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  playerName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  pointsText: {
    color: '#FBBF24',
    fontSize: 17,
    fontWeight: '800',
  },
  subText: {
    color: 'rgba(255,255,255,0.78)',
    marginTop: 4,
    fontSize: 13,
  },
  captainBonus: {
    color: '#FFB4B4',
    marginTop: 2,
    fontSize: 12.5,
    fontWeight: '700',
  },
  rowTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  captainTag: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 12,
    backgroundColor: '#B91C1C',
  },
  captainTagText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 12,
  },
});
