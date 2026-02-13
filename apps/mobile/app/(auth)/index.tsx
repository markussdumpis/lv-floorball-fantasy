import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { COLORS } from '../../src/theme/colors';
import { AppBackground } from '../../src/components/AppBackground';

// Use brand logo; replace if you prefer another mark
const LOGO = require('../../assets/brand/logo-wordmark.png');

export default function AuthLanding() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <AppBackground variant="auth" intensity={1}>
      <SafeAreaView style={[styles.safe, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        <View style={styles.centerContent}>
          <Image source={LOGO} style={styles.logo} resizeMode="contain" />
        </View>
        <View style={[styles.ctaRow, { marginBottom: Math.max(insets.bottom + 12, 28) }]}>
          <Pressable
            style={[styles.cta, styles.ctaGhost]}
            android_ripple={{ color: 'rgba(255,255,255,0.12)' }}
            onPress={() => router.push('/(auth)/login')}
          >
            <Text style={styles.ctaGhostText}>Sign In</Text>
          </Pressable>
          <Pressable
            style={[styles.cta, styles.ctaPrimary]}
            android_ripple={{ color: 'rgba(0,0,0,0.08)' }}
            onPress={() => router.push('/(auth)/signup')}
          >
            <Text style={styles.ctaPrimaryText}>Sign Up</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, justifyContent: 'space-between' },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 0,
  },
  logo: {
    width: 340,
    height: 170,
    marginBottom: 0,
  },
  ctaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    gap: 12,
  },
  cta: {
    flex: 1,
    height: 54,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  ctaGhost: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  ctaGhostText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  ctaPrimary: {
    backgroundColor: COLORS.accent,
  },
  ctaPrimaryText: {
    color: '#0B1024',
    fontSize: 16,
    fontWeight: '700',
  },
});

/*
Notes:
- HERO_BG uses assets/icon.png; swap to your full-screen background if needed.
- LOGO uses assets/brand/logo-wordmark.png; swap if you prefer another mark.
- Buttons navigate to /(auth)/login and /(auth)/signup; adjust if your routes differ.
*/
