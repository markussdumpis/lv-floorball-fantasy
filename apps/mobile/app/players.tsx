import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { usePlayers } from '../src/hooks/usePlayers';
import { PlayerCard } from '../src/components/PlayerCard';
import FilterBar from '../src/components/FilterBar';

export default function Players() {
  const { data, loading, error, refresh, loadMore, hasMore } = usePlayers({
    sort: 'price_desc',
    pageSize: 20,
  });
  const [selectedPosition, setSelectedPosition] = useState<'F' | 'D' | 'G' | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const displayedPlayers = useMemo(() => {
    if (!selectedPosition) return data;
    return data.filter(player => player.position === selectedPosition);
  }, [data, selectedPosition]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } catch (e) {
      console.error('Failed to refresh players', e);
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const renderFooter = () => {
    if (!hasMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color="#3B82F6" />
        <Text style={styles.footerText}>Loading more players...</Text>
      </View>
    );
  };

  const renderError = () => (
    <View style={styles.errorContainer}>
      <Text style={styles.errorText}>Error: {error}</Text>
      <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
        <Text style={styles.retryButtonText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>No players match your filters.</Text>
      <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
        <Text style={styles.retryButtonText}>Refresh</Text>
      </TouchableOpacity>
    </View>
  );

  if (loading && data.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading players...</Text>
        </View>
      </View>
    );
  }

  if (error && data.length === 0) {
    return (
      <View style={styles.container}>
        {renderError()}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FilterBar selected={selectedPosition} onSelect={setSelectedPosition} />
      
      <FlatList
        data={displayedPlayers}
        renderItem={({ item }) => <PlayerCard player={item} />}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={renderFooter}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={renderEmpty}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1E293B',
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    color: '#E2E8F0',
    fontSize: 16,
    marginTop: 12,
    textAlign: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  emptyText: {
    color: '#CBD5E1',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    minHeight: 44, // Accessibility: tap targets >= 44px
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  footerLoader: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
  },
  footerText: {
    color: '#94A3B8',
    fontSize: 14,
    marginLeft: 8,
  },
});
