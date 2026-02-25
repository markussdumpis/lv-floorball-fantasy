import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppBackground } from '../../../src/components/AppBackground';
import { COLORS } from '../../../src/theme/colors';
import { getSupabaseClient } from '../../../src/lib/supabaseClient';

function firstString(value: string | string[] | undefined): string | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function readTokenFromUrl(url: string | null, key: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const queryValue = parsed.searchParams.get(key);
    if (queryValue) return queryValue;
    const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
    if (!hash) return null;
    const hashParams = new URLSearchParams(hash);
    return hashParams.get(key);
  } catch {
    return null;
  }
}

function parseRecoveryPayload(url: string | null) {
  return {
    code: readTokenFromUrl(url, 'code'),
    accessToken: readTokenFromUrl(url, 'access_token'),
    refreshToken: readTokenFromUrl(url, 'refresh_token'),
    type: readTokenFromUrl(url, 'type'),
    errorDescription: readTokenFromUrl(url, 'error_description'),
    error: readTokenFromUrl(url, 'error'),
  };
}

function redactSensitiveUrl(url: string | null): string | null {
  if (!url) return null;
  return url
    .replace(/(access_token=)[^&#]+/gi, '$1[REDACTED]')
    .replace(/(refresh_token=)[^&#]+/gi, '$1[REDACTED]')
    .replace(/(code=)[^&#]+/gi, '$1[REDACTED]')
    .replace(/(token=)[^&#]+/gi, '$1[REDACTED]');
}

export default function RecoveryCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    code?: string | string[];
    access_token?: string | string[];
    refresh_token?: string | string[];
    type?: string | string[];
    error_description?: string | string[];
    error?: string | string[];
  }>();
  const [message, setMessage] = useState('Completing recovery…');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const handledRef = useRef(false);
  const processingRef = useRef(false);

  const paramTokens = useMemo(
    () => ({
      code: firstString(params.code),
      accessToken: firstString(params.access_token),
      refreshToken: firstString(params.refresh_token),
      type: firstString(params.type),
      errorDescription: firstString(params.error_description),
      error: firstString(params.error),
    }),
    [params],
  );

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const processUrl = async (url: string | null) => {
      if (processingRef.current) return;
      processingRef.current = true;

      try {
        if (__DEV__) {
          console.log('[RECOVERY] incoming URL', redactSensitiveUrl(url));
        }
        const parsed = parseRecoveryPayload(url);
        const code = paramTokens.code ?? parsed.code;
        const accessToken = paramTokens.accessToken ?? parsed.accessToken;
        const refreshToken = paramTokens.refreshToken ?? parsed.refreshToken;
        const type = paramTokens.type ?? parsed.type;
        const errorDescription = paramTokens.errorDescription ?? parsed.errorDescription;
        const error = paramTokens.error ?? parsed.error;
        if (__DEV__) {
          console.log('[RECOVERY] parsed', {
            hasCode: !!code,
            hasAccessToken: !!accessToken,
            hasRefreshToken: !!refreshToken,
            type: type ?? null,
            hasError: !!(errorDescription || error),
          });
        }

        if (errorDescription || error) {
          setErrorMessage(errorDescription ?? error ?? 'Invalid or expired link.');
          return;
        }

        const supabase = getSupabaseClient();
        setMessage('Signing you in for password reset…');

        if (code) {
          if (__DEV__) {
            console.log('[RECOVERY] PKCE code received');
          }
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
          if (__DEV__) {
            console.log('[RECOVERY] exchangeCodeForSession success');
          }
          router.replace('/auth/set-password');
          return;
        }

        // Backward compatibility with old implicit-flow links.
        if (accessToken && refreshToken) {
          if (__DEV__) {
            console.log('[RECOVERY] legacy token link received');
          }
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError) throw sessionError;
          if (__DEV__) {
            console.log('[RECOVERY] setSession success');
          }
          router.replace('/auth/set-password');
          return;
        }

        if (type && type !== 'recovery') {
          router.replace('/(tabs)');
          return;
        }

        setErrorMessage('Invalid or expired link. Request a new reset email.');
      } catch (err: any) {
        if (__DEV__) {
          console.log('[RECOVERY] session setup failed', err?.message ?? String(err ?? ''));
        }
        setErrorMessage(err?.message ?? 'Could not start password reset.');
      } finally {
        processingRef.current = false;
      }
    };

    const run = async () => {
      const initialUrl = await Linking.getInitialURL();
      await processUrl(initialUrl);
    };

    void run();

    const sub = Linking.addEventListener('url', event => {
      void processUrl(event.url);
    });
    return () => {
      sub.remove();
    };
  }, [paramTokens, router]);

  if (errorMessage) {
    return (
      <AppBackground variant="home">
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.center}>
            <Text style={styles.errorTitle}>Invalid or expired link</Text>
            <Text style={styles.errorText}>{errorMessage}</Text>
            <Pressable style={({ pressed }) => [styles.button, pressed && styles.pressed]} onPress={() => router.replace('/(auth)/login')}>
              <Text style={styles.buttonText}>Request new link</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  return (
    <AppBackground variant="home">
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.accent2} />
          <Text style={styles.text}>{message}</Text>
        </View>
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 24,
  },
  text: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorTitle: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  errorText: {
    color: COLORS.muted,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  button: {
    marginTop: 6,
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 18,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.86,
  },
});
