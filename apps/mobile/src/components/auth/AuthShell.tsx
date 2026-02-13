import React, { ReactNode, useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppBackground } from '../AppBackground';

const LOGO = require('../../../assets/brand/logo-wordmark.png');

type Props = {
  children?: ReactNode;
  centerLogo?: boolean;
  showTopLogo?: boolean;
  showBottomLogo?: boolean;
};

export function AuthShell({
  children,
  centerLogo = true,
  showTopLogo = true,
  showBottomLogo = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 320, useNativeDriver: true }).start();
  }, [fade]);

  return (
    <AppBackground variant="auth" intensity={1}>
      <SafeAreaView style={styles.safe}>
        {showTopLogo ? (
          <Animated.View
            style={[
              styles.logoWrap,
              centerLogo ? styles.logoCenter : styles.logoHigh,
              { opacity: fade },
            ]}
          >
            <Image source={LOGO} style={styles.logo} resizeMode="contain" />
          </Animated.View>
        ) : null}
        <Animated.View style={{ flex: 1, opacity: fade }}>
          <View style={[styles.content, { paddingBottom: Math.max(insets.bottom, 24) }]}>{children}</View>
        </Animated.View>
        {showBottomLogo ? (
          <Animated.View
            style={[styles.bottomLogoWrap, { paddingBottom: Math.max(insets.bottom + 8, 18), opacity: fade }]}
          >
            <Image source={LOGO} style={styles.bottomLogo} resizeMode="contain" />
          </Animated.View>
        ) : null}
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  logoWrap: {
    alignItems: 'center',
  },
  logoCenter: {
    marginTop: 32,
  },
  logoHigh: {
    marginTop: 8,
    marginBottom: 12,
  },
  logo: {
    width: 240,
    height: 120,
  },
  bottomLogoWrap: {
    alignItems: 'center',
  },
  bottomLogo: {
    width: 210,
    height: 105,
    opacity: 0.9,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
});
