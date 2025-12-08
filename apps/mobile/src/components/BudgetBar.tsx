import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { formatPriceMillions } from '../utils/format';

interface BudgetBarProps {
  spent: number;
  total: number;
}

export function BudgetBar({ spent, total }: BudgetBarProps) {
  const ratio = Math.max(0, Math.min(spent / total, 1));
  const percentage = ratio * 100;
  const remaining = total - spent;
  const barColor = remaining < 0 ? '#F87171' : '#FF6B00';

  return (
    <View style={styles.container}>
      <View style={styles.barContainer}>
        <View style={[styles.bar, { width: `${percentage}%`, backgroundColor: barColor }]} />
      </View>
      <Text style={styles.text}>
        {formatPriceMillions(remaining)} / {formatPriceMillions(total)} remaining
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
  },
  barContainer: {
    height: 8,
    backgroundColor: '#4A5568',
    borderRadius: 8,
    marginBottom: 8,
  },
  bar: {
    height: '100%',
    backgroundColor: '#FF6B00',
    borderRadius: 8,
  },
  text: {
    color: '#CBD5E1',
    fontSize: 14,
    textAlign: 'center',
  },
});
