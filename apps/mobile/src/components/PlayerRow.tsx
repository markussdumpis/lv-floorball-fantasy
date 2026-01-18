import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { POSITIONS } from '../constants/fantasyRules';
import type { Player } from '../types/Player';
import { formatPriceMillions } from '../utils/format';

type PlayerRowProps = {
  player: Player;
  selected: boolean;
  disabled?: boolean;
  onToggle: (playerId: string) => void;
};

export function PlayerRow({ player, selected, disabled, onToggle }: PlayerRowProps) {
  const priceValue =
    typeof player.price_final === 'number' && !Number.isNaN(player.price_final)
      ? formatPriceMillions(player.price_final)
      : 'N/A';
  const priceLabel = priceValue === 'N/A' ? 'Price N/A' : `${priceValue} credits`;
  const teamLabel = player.team ?? 'No Team';

  const handlePress = () => {
    if (disabled && !selected) return;
    onToggle(player.id);
  };

  const buttonLabel = selected ? 'Remove' : 'Add';
  const buttonDisabled = disabled && !selected;

  return (
    <View style={[styles.container, selected && styles.selectedContainer]}>
      <View style={styles.info}>
        <Text style={styles.name}>{player.name}</Text>
        <Text style={styles.meta}>
          {POSITIONS[player.position]} • {teamLabel}
        </Text>
      </View>
      <View style={styles.actions}>
        <Text style={styles.price}>{priceLabel}</Text>
        <TouchableOpacity
          onPress={handlePress}
          disabled={buttonDisabled}
          style={[
            styles.button,
            selected && styles.buttonSelected,
            buttonDisabled && styles.buttonDisabled,
          ]}
        >
          <Text style={styles.buttonText}>
            {buttonDisabled ? 'Locked' : buttonLabel}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#0F172A',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1F2937',
  },
  selectedContainer: {
    backgroundColor: '#1E293B',
  },
  info: {
    flex: 1,
    marginRight: 12,
  },
  name: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  meta: {
    color: '#94A3B8',
    fontSize: 12,
  },
  actions: {
    alignItems: 'flex-end',
  },
  price: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  button: {
    minWidth: 92,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#2563EB',
  },
  buttonSelected: {
    backgroundColor: '#F97316',
  },
  buttonDisabled: {
    backgroundColor: '#334155',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});
