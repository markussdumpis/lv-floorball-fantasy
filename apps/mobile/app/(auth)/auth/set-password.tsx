import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppBackground } from '../../../src/components/AppBackground';
import { COLORS } from '../../../src/theme/colors';
import { getSupabaseClient } from '../../../src/lib/supabaseClient';
import { useAuth } from '../../../src/providers/AuthProvider';
import { useTranslation } from 'react-i18next';

const MIN_PASSWORD_LENGTH = 8;

export default function SetPasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, loading: authLoading, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/(auth)/login');
    }
  }, [authLoading, router, user]);

  const handleSavePassword = async () => {
    const trimmed = password.trim();
    const trimmedConfirm = confirmPassword.trim();

    if (trimmed.length < MIN_PASSWORD_LENGTH) {
      Alert.alert(t('setPassword.invalidPasswordTitle'), t('setPassword.invalidPasswordBody', { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (trimmed !== trimmedConfirm) {
      Alert.alert(t('setPassword.passwordMismatchTitle'), t('setPassword.passwordMismatchBody'));
      return;
    }

    setSubmitting(true);
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.updateUser({ password: trimmed });
      if (error) throw error;

      try {
        await supabase.auth.signOut({ scope: 'global' } as any);
      } catch {
        await signOut();
      }

      Alert.alert(t('setPassword.updatedTitle'), t('setPassword.updatedBody'));
      router.replace('/(auth)/login');
    } catch (err: any) {
      Alert.alert(t('setPassword.updateFailedTitle'), err?.message ?? t('setPassword.updateFailedBody'));
    } finally {
      setSubmitting(false);
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
        <KeyboardAvoidingView
          style={styles.safeArea}
          behavior={Platform.select({ ios: 'padding', android: undefined })}
        >
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>{t('setPassword.title')}</Text>
            <Text style={styles.subtitle}>{t('setPassword.subtitle')}</Text>

            <View style={styles.card}>
              <Text style={styles.label}>{t('setPassword.newPassword')}</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                style={styles.input}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="newPassword"
                placeholder={t('setPassword.atLeastChars', { min: MIN_PASSWORD_LENGTH })}
                placeholderTextColor={COLORS.muted2}
              />

              <Text style={styles.label}>{t('setPassword.confirmPassword')}</Text>
              <TextInput
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                style={styles.input}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="newPassword"
                placeholder={t('setPassword.repeatPassword')}
                placeholderTextColor={COLORS.muted2}
              />
            </View>

            <Pressable
              style={({ pressed }) => [styles.primaryButton, (pressed || submitting) && styles.pressed]}
              onPress={() => {
                void handleSavePassword();
              }}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>{t('setPassword.updatePassword')}</Text>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </AppBackground>
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
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 28,
    gap: 14,
  },
  title: {
    color: COLORS.text,
    fontSize: 30,
    fontWeight: '800',
  },
  subtitle: {
    color: COLORS.muted,
    fontSize: 15,
  },
  card: {
    backgroundColor: 'rgba(6, 13, 35, 0.88)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    gap: 10,
  },
  label: {
    color: COLORS.muted2,
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: 'rgba(255,255,255,0.04)',
    color: COLORS.text,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  primaryButton: {
    marginTop: 6,
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
  pressed: {
    opacity: 0.85,
  },
});
