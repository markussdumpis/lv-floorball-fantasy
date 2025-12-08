import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { usePlayers } from '../src/hooks/usePlayers';
import type { Player } from '../src/types/Player';
import FilterBar from '../src/components/FilterBar';
import { PlayerRow } from '../src/components/PlayerRow';
import { SelectedList } from '../src/components/SelectedList';
import { BudgetBar } from '../src/components/BudgetBar';
import { ROSTER_RULES, TOTAL_BUDGET, type Position } from '../src/constants/fantasyRules';
import { formatPriceMillions } from '../src/utils/format';
import {
  ROSTER_LIMIT,
  canSelect,
  countByPos,
  remainingBudget,
  totalPrice,
  selectionError,
  normalizePosition,
} from '../src/utils/fantasy';
import { getSupabaseClient } from '../src/lib/supabaseClient';

type PositionFilter = Position | null;

export default function Squad() {
  const { data, loading, error, hasMore, loadMore, refresh } = usePlayers({
    sort: 'price_desc',
    pageSize: 25,
  });
  const basePlayers = data ?? [];
  const [loadedPlayers, setLoadedPlayers] = useState<Player[]>([]);
  const [selectedPosition, setSelectedPosition] = useState<PositionFilter>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [captainId, setCaptainId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const players = useMemo(() => {
    if (loadedPlayers.length === 0) return basePlayers;
    const map = new Map<string, Player>();
    basePlayers.forEach(p => map.set(p.id, p));
    loadedPlayers.forEach(p => map.set(p.id, p));
    return Array.from(map.values());
  }, [basePlayers, loadedPlayers]);

  const filteredPlayers = useMemo(() => {
    if (!selectedPosition) return players;
    return players.filter(player => player.position === selectedPosition);
  }, [players, selectedPosition]);

  const counts = useMemo(() => countByPos(players, selectedIds), [players, selectedIds]);
  const priceSpent = useMemo(() => totalPrice(players, selectedIds), [players, selectedIds]);
  const budgetLeft = useMemo(
    () => remainingBudget(TOTAL_BUDGET, players, selectedIds),
    [players, selectedIds]
  );
  const isFull = selectedIds.length === ROSTER_LIMIT;
  const needA = Math.max(ROSTER_RULES.A - counts.A, 0);
  const needD = Math.max(ROSTER_RULES.D - counts.D, 0);
  const needGoalies = Math.max(ROSTER_RULES.V - counts.V, 0);
  const flexLeft = Math.max(ROSTER_RULES.FLEX - counts.FLEX, 0);
  const remainingSlots = Math.max(ROSTER_LIMIT - selectedIds.length, 0);
  const overBudget = budgetLeft < 0;

  const hasEnoughAttackers = counts.A >= ROSTER_RULES.A;
  const hasEnoughDefenders = counts.D >= ROSTER_RULES.D;
  const hasEnoughGoalies = counts.V >= ROSTER_RULES.V;
  const hasCaptain = Boolean(captainId);
  const canSave =
    isFull &&
    hasEnoughAttackers &&
    hasEnoughDefenders &&
    hasEnoughGoalies &&
    hasCaptain &&
    !overBudget;

  const handleTogglePlayer = useCallback(
    (playerId: string) => {
      setSelectedIds(prev => {
        if (prev.includes(playerId)) {
          const next = prev.filter(id => id !== playerId);
          if (captainId === playerId) {
            setCaptainId(null);
          }
          return next;
        }

        const player = players.find(p => p.id === playerId);
        if (!player) return prev;
        const reason = selectionError(player, players, prev);
        if (reason) {
          Alert.alert('Cannot add player', reason);
          return prev;
        }
        return [...prev, playerId];
      });
    },
    [players, captainId]
  );

  const handleSetCaptain = useCallback(
    (playerId: string) => {
      if (!selectedIds.includes(playerId)) return;
      setCaptainId(playerId);
    },
    [selectedIds]
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const supabase = getSupabaseClient();
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        Alert.alert('Not signed in', 'Please sign in to save your squad.');
        return;
      }

      const userId = userData.user.id;

      const { data: team, error: teamError } = await supabase
        .from('fantasy_teams')
        .upsert({ user_id: userId, name: 'My Team' }, { onConflict: 'user_id' })
        .select()
        .single();

      if (teamError || !team) {
        console.error('[Squad] Failed to upsert team', teamError);
        Alert.alert('Save failed', teamError?.message ?? 'Could not save your squad.');
        return;
      }

      const teamId = team.id;

      const { error: deleteError } = await supabase
        .from('fantasy_team_players')
        .delete()
        .eq('fantasy_team_id', teamId);

      if (deleteError) {
        console.error('[Squad] Failed to clear existing squad', deleteError);
        Alert.alert('Save failed', deleteError.message ?? 'Could not save your squad.');
        return;
      }

      if (selectedIds.length > 0) {
        const rows = selectedIds.map(playerId => ({
          fantasy_team_id: teamId,
          player_id: playerId,
          is_captain: captainId === playerId,
        }));

        const { error: insertError } = await supabase.from('fantasy_team_players').insert(rows);
        if (insertError) {
          console.error('[Squad] Failed to insert squad players', insertError);
          Alert.alert('Save failed', insertError.message ?? 'Could not save your squad.');
          return;
        }
      }

      Alert.alert('Squad saved', 'Your squad has been saved.');
    } catch (e: any) {
      console.error('[Squad] Unexpected save error', e);
      Alert.alert('Save failed', e?.message ?? 'Could not save your squad.');
    } finally {
      setSaving(false);
    }
  }, [captainId, selectedIds, saving]);

  const loadSavedSquad = useCallback(async () => {
    try {
      const supabase = getSupabaseClient();
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        return;
      }

      const { data: team, error: teamError } = await supabase
        .from('fantasy_teams')
        .select('id, name')
        .eq('user_id', userData.user.id)
        .maybeSingle();

      if (teamError || !team) {
        return;
      }

      const { data: rows, error: playersError } = await supabase
        .from('fantasy_team_players')
        .select(
          'player:players(id, name, position, team, price_final, price_manual, price_computed, points_total), is_captain'
        )
        .eq('fantasy_team_id', team.id);

      if (playersError || !rows) {
        if (playersError) {
          console.error('[Squad] Failed to load saved squad', playersError);
        }
        return;
      }

      const normalizedPlayers: Player[] = [];
      let captain: string | null = null;

      rows.forEach(row => {
        const player = (row as any).player as Player | null | undefined;
        if (!player) return;
        const normalizedPosition = normalizePosition(player.position);
        const normalizedPlayer: Player = { ...player, position: normalizedPosition };
        normalizedPlayers.push(normalizedPlayer);
        if ((row as any).is_captain) {
          captain = player.id;
        }
      });

      setLoadedPlayers(normalizedPlayers);
      setSelectedIds(normalizedPlayers.map(p => p.id));
      setCaptainId(captain);
    } catch (e) {
      console.error('[Squad] Unexpected load error', e);
    }
  }, []);

  useEffect(() => {
    loadSavedSquad();
  }, [loadSavedSquad]);

  const renderPlayer = useCallback(
    ({ item }: { item: Player }) => {
      const selected = selectedIds.includes(item.id);
      const disabled = !selected && !canSelect(item, players, selectedIds);
      return (
        <PlayerRow
          player={item}
          selected={selected}
          disabled={disabled}
          onToggle={handleTogglePlayer}
        />
      );
    },
    [players, selectedIds, handleTogglePlayer]
  );

  const listFooter = useMemo(() => {
    return (
      <View style={styles.footerContainer}>
        {loading || hasMore ? (
          <View style={styles.footerLoader}>
            <ActivityIndicator color="#3B82F6" />
            <Text style={styles.footerText}>Loading more players...</Text>
          </View>
        ) : null}
        <View style={styles.squadContainer}>
          <Text style={styles.squadTitle}>Your Squad</Text>
          <SelectedList
            players={players}
            selectedIds={selectedIds}
            captainId={captainId}
            onRemove={handleTogglePlayer}
            onSetCaptain={handleSetCaptain}
          />
          <Text style={styles.captainHint}>
            Tap a player to remove them. Use the button to assign your captain.
          </Text>
          <View style={styles.saveButtonWrapper}>
            <TouchableOpacity
              onPress={handleSave}
              disabled={!canSave || saving}
              style={[
                styles.saveButton,
                (!canSave || saving) && styles.saveButtonDisabled,
              ]}
            >
              <Text
                style={[
                  styles.saveButtonText,
                  (!canSave || saving) && styles.saveButtonTextDisabled,
                ]}
              >
                {saving ? 'Saving…' : 'Save Squad'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }, [
    loading,
    hasMore,
    players,
    selectedIds,
    captainId,
    handleTogglePlayer,
    handleSetCaptain,
    handleSave,
    canSave,
  ]);

  return (
    <View style={styles.screen}>
      <FlatList
        data={filteredPlayers ?? []}
        keyExtractor={item => item.id}
        renderItem={renderPlayer}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>
              {error ? 'Failed to load players.' : 'No players found.'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {error ? 'Pull to refresh or try again later.' : 'Adjust filters to see more players.'}
            </Text>
          </View>
        }
        ListHeaderComponent={
          <View>
            <Text style={styles.heading}>Build Your Squad</Text>
            <FilterBar selected={selectedPosition} onSelect={setSelectedPosition} />
            <View style={styles.summaryCard}>
              <Text style={styles.summaryRow}>
                Remaining slots: <Text style={styles.summaryValue}>{remainingSlots}</Text>
              </Text>
              <Text style={styles.summaryRow}>
                Budget left:{' '}
                <Text style={[styles.summaryValue, overBudget && styles.overBudget]}>
                  {formatPriceMillions(budgetLeft)}
                </Text>
              </Text>
              <Text style={styles.summaryRow}>
                Selected: <Text style={styles.summaryValue}>{selectedIds.length}</Text> /{' '}
                {ROSTER_LIMIT}
              </Text>
            </View>
            <BudgetBar spent={priceSpent} total={TOTAL_BUDGET} />
            <View style={styles.messages}>
              <Text style={styles.message}>
                Need {needA} Attackers, {needD} Defenders, {needGoalies} Goalies, Flex left: {flexLeft}
              </Text>
              {overBudget && (
                <Text style={[styles.message, styles.overBudget]}>
                  Over budget by {formatPriceMillions(Math.abs(budgetLeft))}
                </Text>
              )}
            </View>
          </View>
        }
        ListFooterComponent={listFooter}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#3B82F6" />
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#1E293B',
  },
  listContent: {
    paddingBottom: 48,
  },
  heading: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 24,
    marginBottom: 12,
  },
  summaryCard: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  summaryRow: {
    color: '#CBD5E1',
    fontSize: 14,
    marginBottom: 4,
  },
  summaryValue: {
    color: '#38BDF8',
    fontWeight: '600',
  },
  messages: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  message: {
    color: '#CBD5E1',
    fontSize: 13,
    marginBottom: 4,
  },
  overBudget: {
    color: '#F87171',
  },
  footerLoader: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerText: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 8,
  },
  footerContainer: {
    paddingBottom: 24,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyTitle: {
    color: '#F1F5F9',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptySubtitle: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  squadContainer: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    backgroundColor: '#0F172A',
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    gap: 12,
  },
  squadTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
  },
  captainHint: {
    color: '#94A3B8',
    fontSize: 12,
  },
  saveButtonWrapper: {
    alignItems: 'stretch',
  },
  saveButton: {
    backgroundColor: '#F97316',
    borderRadius: 12,
    paddingVertical: 14,
  },
  saveButtonDisabled: {
    backgroundColor: '#334155',
  },
  saveButtonText: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  saveButtonTextDisabled: {
    color: '#94A3B8',
  },
});
