import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { POSITIONS } from '../constants/fantasyRules';
import { Player } from '../types/Player';
import { formatPriceMillions } from '../utils/format';
import { getPlayerPrice } from '../utils/fantasy';

interface PlayerCardProps {
  player: Player;
}

export function PlayerCard({ player }: PlayerCardProps) {
  const rawPrice = getPlayerPrice(player);
  const price = rawPrice > 0 ? `${formatPriceMillions(rawPrice)} credits` : 'N/A';
  const points =
    typeof player.points_total === 'number' ? `${player.points_total.toFixed(1)} pts` : 'Points --';
  const team = player.team || 'No Team';

  return (
    <View style={styles.container}>
      <View style={styles.info}>
        <Text style={styles.name}>{player.name}</Text>
        <Text style={styles.details}>{POSITIONS[player.position]} • {team}</Text>
      </View>
      <View style={styles.stats}>
        <View style={styles.positionBadge}>
          <Text style={styles.positionText}>{POSITIONS[player.position]}</Text>
        </View>
        <Text style={styles.price}>{price}</Text>
        <Text style={styles.points}>{points}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#2D3748',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  info: {
    flex: 1,
  },
  name: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  details: {
    color: '#CBD5E1',
    fontSize: 14,
  },
  stats: {
    alignItems: 'flex-end',
  },
  positionBadge: {
    backgroundColor: '#FF6B00',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 4,
  },
  positionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  price: {
    color: '#FF6B00',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  points: {
    color: '#22C55E',
    fontSize: 12,
    fontWeight: '500',
  },
});
