import { Slot, useRouter, useSegments } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useEffect, useState } from 'react';
import * as Linking from 'expo-linking';
import { AuthProvider, useAuth } from '../src/providers/AuthProvider';
import { TourProvider } from '../src/providers/TourProvider';
import { COLORS } from '../src/theme/colors';
import i18n, { initI18n } from '../src/i18n';

export default function RootLayout() {
  const [i18nReady, setI18nReady] = useState(false);
  const [, setLangTick] = useState(0);

  useEffect(() => {
    let mounted = true;
    void initI18n()
      .catch(() => {})
      .finally(() => {
        if (mounted) setI18nReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const onLanguageChanged = () => {
      setLangTick(value => value + 1);
    };
    i18n.on('languageChanged', onLanguageChanged);
    return () => {
      i18n.off('languageChanged', onLanguageChanged);
    };
  }, []);

  if (!i18nReady) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.accent} />
      </View>
    );
  }

  return (
    <AuthProvider>
      <TourProvider>
        <AuthGate />
      </TourProvider>
    </AuthProvider>
  );
}

function AuthGate() {
  const router = useRouter();
  const segments = useSegments();
  const { user, loading, configError } = useAuth();

  useEffect(() => {
    let mounted = true;
    const redact = (url: string | null) => {
      if (!url) return url;
      return url.replace(/(code|access_token|refresh_token|id_token)=([^&]+)/gi, '$1=[REDACTED]');
    };
    Linking.getInitialURL().then(url => {
      if (!mounted) return;
      if (__DEV__) console.log('[deeplink] initial', redact(url));
    });
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (__DEV__) console.log('[deeplink] received', redact(url));
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!user && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (user && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [loading, user, segments, router]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.accent} />
        <Text style={styles.loadingText}>{i18n.t('app.loadingAccount')}</Text>
      </View>
    );
  }

  if (configError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{configError}</Text>
      </View>
    );
  }

  return <Slot />;
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  loadingText: {
    color: COLORS.muted,
    marginTop: 12,
    fontSize: 16,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 16,
    textAlign: 'center',
  },
});
