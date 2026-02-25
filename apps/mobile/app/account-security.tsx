import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { AppBackground } from '../src/components/AppBackground';
import { COLORS } from '../src/theme/colors';
import { getSupabaseClient } from '../src/lib/supabaseClient';
import { useAuth } from '../src/providers/AuthProvider';

type SecurityState = {
  email: string | null;
  provider: string | null;
  providers: string[];
  isOAuth: boolean;
  isGoogle: boolean;
  userId: string | null;
};

function toProviderLabel(provider: string | null): string {
  if (!provider) return 'Email';
  if (provider === 'email') return 'Email';
  if (provider === 'google') return 'Google';
  if (provider === 'apple') return 'Apple';
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function deriveProviderState(sourceUser: any) {
  const providerFromMeta =
    typeof sourceUser?.app_metadata?.provider === 'string' ? sourceUser.app_metadata.provider : 'email';
  const providersFromIdentities = Array.isArray(sourceUser?.identities)
    ? sourceUser.identities
        .map((identity: any) => (typeof identity?.provider === 'string' ? identity.provider : null))
        .filter((provider: string | null): provider is string => !!provider)
    : [];
  const allProviders = Array.from(new Set([providerFromMeta, ...providersFromIdentities])).filter(Boolean);
  const isOAuth = allProviders.some(provider => provider !== 'email') || providerFromMeta !== 'email';
  const isGoogle = providerFromMeta === 'google' || allProviders.includes('google');

  return {
    provider: providerFromMeta,
    providers: allProviders,
    isOAuth,
    isGoogle,
  };
}

function buildPasswordResetRedirectUrl() {
  const generated = Linking.createURL('auth/callback');
  // Guard against web/localhost-style redirects that break on device.
  if (!generated || generated.includes('localhost')) {
    return 'lvfloorball://auth/callback';
  }
  return generated;
}

async function withHardTimeout<T>(operation: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(code)), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export default function AccountSecurityScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [sendingReset, setSendingReset] = useState(false);
  const [state, setState] = useState<SecurityState>({
    email: null,
    provider: null,
    providers: [],
    isOAuth: false,
    isGoogle: false,
    userId: null,
  });

  const providerLabel = useMemo(() => {
    return toProviderLabel(state.provider);
  }, [state.provider]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/(auth)/login');
      return;
    }

    const nextProviderState = deriveProviderState(user);

    setState({
      email: user.email ?? null,
      provider: nextProviderState.provider,
      providers: nextProviderState.providers,
      isOAuth: nextProviderState.isOAuth,
      isGoogle: nextProviderState.isGoogle,
      userId: user.id ?? null,
    });

    const hydrateFromGetUser = async () => {
      try {
        const supabase = getSupabaseClient();
        const { data } = await withHardTimeout(
          supabase.auth.getUser(),
          8_000,
          'ACCOUNT_SECURITY_GET_USER_TIMEOUT',
        );
        const liveUser = data?.user;
        if (!liveUser) return;
        const liveProviderState = deriveProviderState(liveUser);
        setState(prev => ({
          ...prev,
          email: liveUser.email ?? prev.email,
          userId: liveUser.id ?? prev.userId,
          provider: liveProviderState.provider,
          providers: liveProviderState.providers,
          isOAuth: liveProviderState.isOAuth,
          isGoogle: liveProviderState.isGoogle,
        }));
      } catch {
        // keep fallback from auth context
      }
    };

    void hydrateFromGetUser();
  }, [authLoading, router, user]);

  const handleSendReset = async () => {
    if (sendingReset) return;
    if (!state.email) {
      Alert.alert('Missing email', 'No email found for this account.');
      return;
    }
    setSendingReset(true);
    try {
      const supabase = getSupabaseClient();
      const redirectTo = buildPasswordResetRedirectUrl();
      if (__DEV__) {
        console.log('[RESET-PW] redirectTo', redirectTo);
        console.log('[RESET-PW] email', state.email);
      }
      const { error } = await withHardTimeout(
        supabase.auth.resetPasswordForEmail(state.email, { redirectTo }),
        12_000,
        'ACCOUNT_SECURITY_RESET_TIMEOUT',
      );
      if (error) throw error;
      if (__DEV__) {
        console.log('[RESET-PW] request ok');
      }
      Alert.alert('Success', 'Password reset email sent');
    } catch (err: any) {
      if (__DEV__) {
        console.log('[RESET-PW] request failed', err instanceof Error ? err.message : String(err ?? ''));
      }
      const message = err instanceof Error ? err.message : String(err ?? '');
      if (message.includes('TIMEOUT')) {
        Alert.alert('Reset failed', 'Request timed out. Please try again.');
      } else {
        Alert.alert('Reset failed', err?.message ?? 'Could not send password reset email.');
      }
    } finally {
      setSendingReset(false);
    }
  };

  if (authLoading) {
    return (
      <AppBackground variant="home">
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={COLORS.accent2} />
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <AppBackground variant="home">
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Account Security</Text>

          <View style={styles.card}>
            <Field label="Email" value={state.email ?? '—'} />
            <Field label="Auth provider" value={providerLabel} />
            <Field label="User ID" value={state.userId ?? '—'} mono />
          </View>

          {!state.isOAuth ? (
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                (pressed || sendingReset) && styles.pressed,
                sendingReset && styles.disabled,
              ]}
              onPress={() => {
                void handleSendReset();
              }}
              disabled={sendingReset || !state.email}
            >
              {sendingReset ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>Send password reset email</Text>
              )}
            </Pressable>
          ) : (
            <View style={styles.oauthCallout}>
              <Text style={styles.oauthCalloutText}>
                {state.isGoogle
                  ? "You’re signed in with Google. Password changes are managed in your Google account."
                  : `You’re signed in with ${providerLabel}. Password changes are managed in your ${providerLabel} account.`}
              </Text>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            onPress={() => router.back()}
          >
            <Text style={styles.secondaryButtonText}>Back</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </AppBackground>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[styles.fieldValue, mono && styles.mono]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 28,
    gap: 14,
  },
  title: {
    color: COLORS.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  card: {
    backgroundColor: 'rgba(6, 13, 35, 0.88)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    gap: 12,
  },
  fieldRow: {
    gap: 4,
  },
  fieldLabel: {
    color: COLORS.muted2,
    fontSize: 13,
    fontWeight: '600',
  },
  fieldValue: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
  },
  mono: {
    fontFamily: 'Menlo',
    fontSize: 13,
  },
  primaryButton: {
    marginTop: 8,
    height: 52,
    borderRadius: 14,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '600',
  },
  oauthCallout: {
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  oauthCalloutText: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.7,
  },
});
