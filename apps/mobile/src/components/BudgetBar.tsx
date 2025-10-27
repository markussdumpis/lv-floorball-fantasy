import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface BudgetBarProps {
  spent: number;
  total: number;
}

export function BudgetBar({ spent, total }: BudgetBarProps) {
  const percentage = (spent / total) * 100;
  const remaining = total - spent;

  return (
    <View style={styles.container}>
      <View style={styles.barContainer}>
        <View style={[styles.bar, { width: `${percentage}%` }]} />
      </View>
      <Text style={styles.text}>
        {remaining.toFixed(1)} / {total} credits remaining
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

