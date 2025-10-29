import React, { useCallback, useMemo, useState } from 'react';
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
import {
  RULES,
  ROSTER_LIMIT,
  canSelect,
  countByPos,
  isValidTeam,
  remainingBudget,
  totalPrice,
} from '../src/utils/fantasy';

const TOTAL_BUDGET = 10000;

type PositionFilter = 'F' | 'D' | 'G' | null;

export default function Squad() {
  const { data, loading, error, hasMore, loadMore, refresh } = usePlayers({
    sort: 'price_desc',
    pageSize: 25,
  });
  const [selectedPosition, setSelectedPosition] = useState<PositionFilter>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [captainId, setCaptainId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const filteredPlayers = useMemo(() => {
    if (!selectedPosition) return data;
    return data.filter(player => player.position === selectedPosition);
  }, [data, selectedPosition]);

  const counts = useMemo(() => countByPos(data, selectedIds), [data, selectedIds]);
  const priceSpent = useMemo(() => totalPrice(data, selectedIds), [data, selectedIds]);
  const budgetLeft = useMemo(
    () => remainingBudget(TOTAL_BUDGET, data, selectedIds),
    [data, selectedIds]
  );
  const needF = Math.max(RULES.F - counts.F, 0);
  const needD = Math.max(RULES.D - counts.D, 0);
  const needG = Math.max(RULES.G - counts.G, 0);
  const flexLeft = Math.max(RULES.FLEX - counts.FLEX, 0);
  const remainingSlots = Math.max(ROSTER_LIMIT - selectedIds.length, 0);
  const overBudget = budgetLeft < 0;

  const squadIsValid = isValidTeam(data, selectedIds, TOTAL_BUDGET);
  const canSave = squadIsValid && Boolean(captainId);

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

        const player = data.find(p => p.id === playerId);
        if (!player) return prev;
        if (!canSelect(player, data, prev)) return prev;
        return [...prev, playerId];
      });
    },
    [data, captainId]
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

  const handleSave = useCallback(() => {
    Alert.alert('Saved locally', 'Your squad has been saved on this device.');
  }, []);

  const renderPlayer = useCallback(
    ({ item }: { item: Player }) => {
      const selected = selectedIds.includes(item.id);
      const disabled = !selected && !canSelect(item, data, selectedIds);
      return (
        <PlayerRow
          player={item}
          selected={selected}
          disabled={disabled}
          onToggle={handleTogglePlayer}
        />
      );
    },
    [data, selectedIds, handleTogglePlayer]
  );

  const listFooter = useMemo(() => {
    if (!loading && !hasMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator color="#3B82F6" />
        <Text style={styles.footerText}>Loading more players...</Text>
      </View>
    );
  }, [loading, hasMore]);

  return (
    <View style={styles.screen}>
      <FlatList
        data={filteredPlayers}
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
                  {budgetLeft}
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
                Need {needF} F, {needD} D, {needG} G, Flex left: {flexLeft}
              </Text>
              {overBudget && (
                <Text style={[styles.message, styles.overBudget]}>
                  Over budget by {Math.abs(budgetLeft)}
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
      <View style={styles.squadContainer}>
        <Text style={styles.squadTitle}>Your Squad</Text>
        <SelectedList
          players={data}
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
            disabled={!canSave}
            style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
          >
            <Text style={[styles.saveButtonText, !canSave && styles.saveButtonTextDisabled]}>
              Save Squad
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#1E293B',
  },
  listContent: {
    paddingBottom: 24,
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
