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
      const rowsMapped: PlayerPointsRow[] = (pointsRows ?? []).map(row => ({
        playerId: (row as any).player_id,
        name: (row as any).name ?? 'Unknown player',
        position: (row as any).position ?? null,
        isCaptain: Boolean((row as any).is_captain),
        basePoints: Number((row as any).base_points ?? 0) || 0,
        captainBonus: Number((row as any).captain_bonus ?? 0) || 0,
        totalPoints: Number((row as any).total_points ?? 0) || 0,
      }));

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
        <Text style={styles.playerName}>
          {item.name} {item.isCaptain ? '(C)' : ''}
        </Text>
        <Text style={styles.pointsText}>{item.totalPoints.toFixed(2)}</Text>
      </View>
      <Text style={styles.subText}>
        Position: {item.position ?? 'Unknown'} • Base: {item.basePoints.toFixed(2)} • Captain bonus: {item.captainBonus.toFixed(2)}
      </Text>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.statusText}>Loading your points…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingTop: 24,
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
    paddingBottom: 24,
  },
  row: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  playerName: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  pointsText: {
    color: '#FBBF24',
    fontSize: 16,
    fontWeight: '700',
  },
  subText: {
    color: '#CBD5E1',
    marginTop: 4,
    fontSize: 13,
  },
});
