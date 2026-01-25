import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 16 }]}>
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.label}>User ID</Text>
      <Text style={styles.value}>{id || 'Unknown'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#05070f',
    paddingHorizontal: 20,
    gap: 8,
  },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
  },
  label: {
    color: '#9aa0b5',
    fontSize: 13,
    marginTop: 12,
  },
  value: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
