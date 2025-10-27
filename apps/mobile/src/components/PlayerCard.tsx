import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Player } from '../types/Player';

interface PlayerCardProps {
  player: Player;
  onPress?: () => void;
}

export function PlayerCard({ player, onPress }: PlayerCardProps) {
  return (
    <View style={styles.container}>
      <View style={styles.info}>
        <Text style={styles.name}>{player.name}</Text>
        <Text style={styles.details}>{player.position} • {player.team}</Text>
      </View>
      <View style={styles.stats}>
        <Text style={styles.price}>${player.price}</Text>
        <Text style={styles.fppg}>{player.fppg.toFixed(1)} FPPG</Text>
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
  price: {
    color: '#FF6B00',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  fppg: {
    color: '#22C55E',
    fontSize: 12,
  },
});

