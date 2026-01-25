import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { TEAM_LOGOS } from '../constants/teamLogos';

type Props = {
  team: string | null | undefined;
  size?: number;
};

export function TeamBadge({ team, size = 24 }: Props) {
  const teamKey = (team ?? '').trim().toUpperCase();
  const logoSource = teamKey ? TEAM_LOGOS[teamKey] : null;
  const initials = teamKey.slice(0, 3) || '—';

  if (logoSource) {
    return (
      <Image
        source={logoSource}
        style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1, borderColor: '#1F2937' }}
        resizeMode="contain"
      />
    );
  }

  return (
    <View
      style={[
        styles.fallback,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
      ]}
    >
      <Text style={styles.initials}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1F2937',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
});
