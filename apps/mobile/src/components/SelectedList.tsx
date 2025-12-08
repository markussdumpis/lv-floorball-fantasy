import React, { Fragment } from 'react';
import { View, Text, StyleSheet, Pressable, GestureResponderEvent } from 'react-native';
import {
  FLEX_ALLOWED_POSITIONS,
  POSITIONS,
  ROSTER_RULES,
  type Position,
} from '../constants/fantasyRules';
import type { Player } from '../types/Player';
import { formatPriceMillions } from '../utils/format';
import { getPlayerPrice, normalizePosition } from '../utils/fantasy';

type SelectedListProps = {
  players: Player[];
  selectedIds: string[];
  captainId: string | null;
  onRemove: (playerId: string) => void;
  onSetCaptain: (playerId: string) => void;
};

type GroupedPlayers = Record<Position | 'FLEX', Player[]>;

const SECTION_LABELS: Record<keyof GroupedPlayers, string> = {
  A: 'Attackers',
  D: 'Defenders',
  V: 'Goalie',
  FLEX: 'Flex',
};

const buildGroups = (players: Player[], selectedIds: string[]): GroupedPlayers => {
  const ordered = selectedIds
    .map(id => players.find(player => player.id === id))
    .filter((player): player is Player => Boolean(player));

  const groups: GroupedPlayers = { A: [], D: [], V: [], FLEX: [] };

  ordered.forEach(player => {
    const rawPosition = player.position;
    const position = normalizePosition(rawPosition);
    const slot = groups[position];
    if (!slot) {
      console.warn('[Squad] No slot group for position', position, 'raw=', rawPosition);
      return;
    }
    if (slot.length < ROSTER_RULES[position]) {
      slot.push(player);
      return;
    }

    if (FLEX_ALLOWED_POSITIONS.includes(position)) {
      groups.FLEX.push(player);
      return;
    }

    slot.push(player);
  });

  return groups;
};

export function SelectedList({
  players,
  selectedIds,
  captainId,
  onRemove,
  onSetCaptain,
}: SelectedListProps) {
  const groups = buildGroups(players, selectedIds);
  const hasSelection = selectedIds.length > 0;

  const handleCaptainPress = (event: GestureResponderEvent, playerId: string) => {
    event.stopPropagation();
    onSetCaptain(playerId);
  };

  if (!hasSelection) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>Your squad is empty</Text>
        <Text style={styles.emptySubtitle}>
          Add players from the list above to start building your squad.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {Object.entries(groups).map(([key, groupPlayers]) => (
        <Fragment key={key}>
          <Text style={styles.sectionTitle}>{SECTION_LABELS[key as keyof GroupedPlayers]}</Text>
          {groupPlayers.length === 0 ? (
            <Text style={styles.sectionEmpty}>No players assigned.</Text>
          ) : (
            groupPlayers.map(player => {
              const isCaptain = captainId === player.id;
              const rawPrice = getPlayerPrice(player);
              const priceLabel = rawPrice > 0 ? formatPriceMillions(rawPrice) : 'N/A';
              return (
                <Pressable
                  key={player.id}
                  onPress={() => onRemove(player.id)}
                  style={styles.row}
                >
                  <View style={styles.playerInfo}>
                    <Text style={styles.playerName}>
                      {player.name}
                      {isCaptain ? ' (C)' : ''}
                    </Text>
                    <Text style={styles.playerMeta}>
                      {player.team ?? 'No Team'} • {POSITIONS[normalizePosition(player.position)]}
                    </Text>
                  </View>
                  <View style={styles.rowActions}>
                    <Text style={styles.priceText}>
                      {priceLabel}
                    </Text>
                    <Pressable
                      onPress={event => handleCaptainPress(event, player.id)}
                      style={[styles.captainButton, isCaptain && styles.captainButtonActive]}
                    >
                      <Text style={styles.captainButtonText}>
                        {isCaptain ? 'Captain' : 'Set Captain'}
                      </Text>
                    </Pressable>
                  </View>
                </Pressable>
              );
            })
          )}
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  emptyState: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 24,
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptySubtitle: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
  },
  sectionTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 6,
  },
  sectionEmpty: {
    color: '#64748B',
    fontSize: 12,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1E293B',
  },
  playerInfo: {
    flex: 1,
    marginRight: 12,
  },
  playerName: {
    color: '#F1F5F9',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  playerMeta: {
    color: '#94A3B8',
    fontSize: 12,
  },
  rowActions: {
    alignItems: 'flex-end',
  },
  priceText: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  captainButton: {
    backgroundColor: '#1E293B',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  captainButtonActive: {
    backgroundColor: '#F97316',
    borderColor: '#F97316',
  },
  captainButtonText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '600',
  },
});
