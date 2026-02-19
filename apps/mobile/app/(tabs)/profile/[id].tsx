import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppBackground } from '../../../src/components/AppBackground';

const LOGO = require('../../../assets/brand/logo-wordmark.png');

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();

  return (
    <AppBackground variant="home">
      <View style={[styles.screen, { paddingTop: insets.top + 24, paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.logoWrap}>
          <Image source={LOGO} resizeMode="contain" style={styles.logo} />
        </View>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 24,
  },
  logoWrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-start',
    opacity: 0.9,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    marginTop: 24,
  },
  logo: {
    width: 300,
    height: 165,
  },
});
