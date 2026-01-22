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
import { getSupabaseClient } from '../src/lib/supabaseClient';

type PlayerPointsRow = {
  playerId: string;
  name: string;
  position: string | null;
  isCaptain: boolean;
  basePoints: number;
  displayPoints: number;
};

const LOG_PREFIX = '[MyPoints]';

export default function MyPointsScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<PlayerPointsRow[]>([]);
  const [teamName, setTeamName] = useState<string | null>(null);

  const totalPoints = useMemo(
    () => rows.reduce((sum, row) => sum + (Number.isFinite(row.displayPoints) ? row.displayPoints : 0), 0),
    [rows],
  );

  const loadPoints = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = getSupabaseClient();

    try {
      console.log(`${LOG_PREFIX} Step 1: fetch current user`);
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) {
        console.error(`${LOG_PREFIX} Step 1 error`, userError);
        setError(userError.message ?? 'Failed to fetch user.');
        setRows([]);
        return;
      }
      if (!userData?.user) {
        console.log(`${LOG_PREFIX} No authenticated user found; showing 0 points.`);
        setError('Please log in');
        setRows([]);
        return;
      }
      const userId = userData.user.id;
      console.log(`${LOG_PREFIX} Step 1: user id`, userId);

      console.log(`${LOG_PREFIX} Step 2: fetch latest fantasy team for user`);
      const { data: team, error: teamError } = await supabase
        .from('fantasy_teams')
        .select('id, created_at, name')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      console.log(`${LOG_PREFIX} Step 2 rows`, team ? 1 : 0);

      if (teamError) {
        console.error(`${LOG_PREFIX} Step 2 error`, teamError);
        setError(teamError.message ?? 'Failed to fetch your fantasy team.');
        setRows([]);
        return;
      }
      if (!team) {
        console.log(`${LOG_PREFIX} No fantasy team found; showing 0 points.`);
        setError('No fantasy team found');
        setRows([]);
        return;
      }
      setTeamName(team.name ?? 'My Team');
      console.log(`${LOG_PREFIX} Fantasy team id`, team.id);

      console.log(`${LOG_PREFIX} Step 3: fetch roster rows for team ${team.id}`);
      const { data: rosterData, error: rosterError } = await supabase
        .from('fantasy_team_players')
        .select('player_id, is_captain')
        .eq('fantasy_team_id', team.id);
      const rosterCount = rosterData?.length ?? 0;
      console.log(`${LOG_PREFIX} Step 3 rows`, rosterCount);

      if (rosterError) {
        console.error(`${LOG_PREFIX} Step 3 error`, rosterError);
        setError(rosterError.message ?? 'Failed to load roster.');
        setRows([]);
        return;
      }
      const roster = rosterData ?? [];
      if (roster.length === 0) {
        console.log(`${LOG_PREFIX} Roster empty; showing 0 points.`);
        setError('No players in team');
        setRows([]);
        return;
      }

      const playerIds = roster.map(row => row.player_id).filter(Boolean);
      console.log(`${LOG_PREFIX} Step 4: fetch player details for ${playerIds.length} ids`);
      const { data: playerDetails, error: playersError } = await supabase
        .from('players')
        .select('id, name, position, team_id')
        .in('id', playerIds);
      console.log(`${LOG_PREFIX} Step 4 rows`, playerDetails?.length ?? 0);

      if (playersError) {
        console.error(`${LOG_PREFIX} Step 4 error`, playersError);
        setError(playersError.message ?? 'Failed to load player details.');
        setRows([]);
        return;
      }
      const playersMap = new Map((playerDetails ?? []).map(player => [player.id, player]));

      console.log(`${LOG_PREFIX} Step 5: fetch finished match ids for season 2025-26`);
      const { data: finishedMatches, error: matchError } = await supabase
        .from('matches')
        .select('id, date')
        .eq('status', 'finished')
        .eq('season', '2025-26')
        .order('date', { ascending: true });
      const matchIds = (finishedMatches ?? []).map(m => (m as any).id);
      console.log(`${LOG_PREFIX} Step 5 finished matches`, matchIds.length);

      if (matchError) {
        console.error(`${LOG_PREFIX} Step 5 error`, matchError);
        setError(matchError.message ?? 'Failed to load finished matches.');
        setRows([]);
        return;
      }

      if (matchIds.length === 0) {
        console.log(`${LOG_PREFIX} No finished matches for season; showing 0 points.`);
        setError('No finished matches yet');
        const zeroRows = roster.map(row => {
          const player = playersMap.get(row.player_id);
          if (!player) {
            console.log(`${LOG_PREFIX} Missing player details for id ${row.player_id}`);
          }
          return {
            playerId: row.player_id,
            name: player?.name ?? 'Unknown player',
            position: player?.position ?? null,
            isCaptain: Boolean(row.is_captain),
            basePoints: 0,
            displayPoints: 0,
          };
        });
        setRows(zeroRows);
        return;
      }

      console.log(
        `${LOG_PREFIX} Step 6: fetch player_match_points_view for ${playerIds.length} players across ${matchIds.length} matches`
      );
      const { data: pointsRows, error: pointsError } = await supabase
        .from('player_match_points_view')
        .select('player_id, team_id, match_id, points, goals, assists, pen_min, position')
        .in('match_id', matchIds)
        .in('player_id', playerIds);
      console.log(`${LOG_PREFIX} Step 6 rows`, pointsRows?.length ?? 0, 'firstRow', pointsRows?.[0]);

      if (pointsError) {
        console.error(`${LOG_PREFIX} Step 6 error`, pointsError);
        setError(pointsError.message ?? 'Failed to load player match points.');
      }

      const totalsMap = new Map<
        string,
        { points: number; goals: number; assists: number; penMin: number; position: string | null }
      >();
      (pointsRows ?? []).forEach(row => {
        const pid = (row as any).player_id;
        const rawPoints = (row as any).points ?? 0;
        const normalized = typeof rawPoints === 'number' ? rawPoints : Number(rawPoints) || 0;
        const goals = Number((row as any).goals ?? 0) || 0;
        const assists = Number((row as any).assists ?? 0) || 0;
        const penMin = Number((row as any).pen_min ?? 0) || 0;
        const position = (row as any).position ?? null;
        const existing = totalsMap.get(pid) ?? { points: 0, goals: 0, assists: 0, penMin: 0, position };
        totalsMap.set(pid, {
          points: existing.points + normalized,
          goals: existing.goals + goals,
          assists: existing.assists + assists,
          penMin: existing.penMin + penMin,
          position: existing.position ?? position,
        });
      });
      console.log(`${LOG_PREFIX} Aggregated players`, totalsMap.size);
      console.log(
        `${LOG_PREFIX} Sample totals`,
        Array.from(totalsMap.entries())
          .slice(0, 3)
          .map(([pid, v]) => ({ pid, ...v })),
      );

      const displayRows: PlayerPointsRow[] = roster.map(row => {
        const player = playersMap.get(row.player_id);
        const totals = totalsMap.get(row.player_id);
        const basePoints = totals?.points ?? 0;
        if (!totalsMap.has(row.player_id)) {
          console.log(
            `${LOG_PREFIX} no points row for player_id=${row.player_id} defaulting to 0`
          );
        }
        if (!player) {
          console.log(`${LOG_PREFIX} Missing player details for id ${row.player_id}`);
        }
        const isCaptain = Boolean(row.is_captain);
        const displayPoints = isCaptain ? basePoints * 2 : basePoints;
        return {
          playerId: row.player_id,
          name: player?.name ?? 'Unknown player',
          position: player?.position ?? totals?.position ?? null,
          isCaptain,
          basePoints,
          displayPoints,
        };
      });

      setRows(displayRows);
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
        <Text style={styles.pointsText}>{item.displayPoints.toFixed(2)}</Text>
      </View>
      <Text style={styles.subText}>
        Position: {item.position ?? 'Unknown'} • Base: {item.basePoints.toFixed(2)}
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
