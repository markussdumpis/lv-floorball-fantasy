import React, { useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/providers/AuthProvider';
import { looksLikeEmail, sanitizeEmail } from '../../src/utils/email';
import { COLORS } from '../../src/theme/colors';
import { AuthShell } from '../../src/components/auth/AuthShell';
import { useTranslation } from 'react-i18next';
import { AppLanguage, getCurrentAppLanguage, setAppLanguage } from '../../src/i18n';

type Mode = 'signIn' | 'signUp';

type Props = {
  initialMode?: Mode;
};

export function AuthScreen({ initialMode = 'signIn' }: Props) {
  const router = useRouter();
  const { t } = useTranslation();
  const { signInWithEmail, signUpWithEmail, signInWithGoogle, setNicknameForUser, signOut, loading: authLoading } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<Mode>(initialMode);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [language, setLanguage] = useState<AppLanguage>(getCurrentAppLanguage());

  const handleEmailAuth = async () => {
    const sanitizedEmail = sanitizeEmail(email);
    const trimmedPassword = password.trim();

    if (!sanitizedEmail) {
      setError(t('auth.errors.emailRequired'));
      return;
    }
    if (!trimmedPassword) {
      setError(t('auth.errors.passwordRequired'));
      return;
    }
    if (!looksLikeEmail(sanitizedEmail)) {
      setError(t('auth.errors.emailInvalid'));
      return;
    }

    const nicknameNeeded = mode === 'signUp';
    const trimmedNickname = nickname.trim();
    if (nicknameNeeded) {
      if (!trimmedNickname) {
        setError(t('auth.errors.nicknameRequired'));
        return;
      }
      if (trimmedNickname.length < 3 || trimmedNickname.length > 20) {
        setError(t('auth.errors.nicknameLength'));
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      if (mode === 'signIn') {
        await signInWithEmail(sanitizedEmail, trimmedPassword);
        router.replace('/(tabs)');
      } else {
        const session = await signUpWithEmail(sanitizedEmail, trimmedPassword, trimmedNickname, language);
        if (session?.user?.id) {
          if (nicknameNeeded) {
            try {
              await setNicknameForUser(session.user.id, trimmedNickname);
            } catch (nickErr: any) {
              setError(nickErr?.message ?? t('auth.errors.nicknameSaveFailed'));
              return;
            }
          }
          router.replace('/(tabs)');
        } else {
          setMessage(t('auth.messages.accountCreated'));
        }
      }
    } catch (e: any) {
      setError(e.message ?? t('auth.errors.authFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const session = await signInWithGoogle();
      if (!session) {
        setError(t('auth.errors.googleIncomplete'));
        return;
      }
      if (mode === 'signUp') {
        // If user is trying to sign up but the Google account already exists,
        // show a friendly message and keep them on the auth screen.
        if (nickname.trim().length < 3) {
          setError(t('auth.errors.nicknameRequiredSignup'));
          await signOut();
          return;
        }
        const nick = nickname.trim();
        try {
          await setNicknameForUser(session.user.id, nick);
        } catch (nickErr: any) {
          setError(nickErr?.message ?? t('auth.errors.nicknameSaveFailed'));
          await signOut();
          return;
        }
        router.replace('/(tabs)');
        return;
      }
      router.replace('/(tabs)');
    } catch (e: any) {
      setError(e.message ?? t('auth.errors.googleFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleLanguagePick = async (lang: AppLanguage) => {
    setLanguage(lang);
    await setAppLanguage(lang);
  };

  return (
    <AuthShell centerLogo={false} showTopLogo={false} showBottomLogo>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.select({ ios: 'padding', android: undefined })}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            <View style={styles.glassCard}>
              {mode === 'signUp' ? (
                <View style={styles.langWrap}>
                  <Text style={styles.langLabel}>{t('auth.language')}</Text>
                  <View style={styles.langRow}>
                    <TouchableOpacity
                      style={[styles.langBtn, language === 'en' && styles.langBtnActive]}
                      onPress={() => {
                        void handleLanguagePick('en');
                      }}
                      disabled={submitting || authLoading}
                    >
                      <Text style={[styles.langBtnText, language === 'en' && styles.langBtnTextActive]}>
                        🇬🇧 {t('language.english')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.langBtn, language === 'lv' && styles.langBtnActive]}
                      onPress={() => {
                        void handleLanguagePick('lv');
                      }}
                      disabled={submitting || authLoading}
                    >
                      <Text style={[styles.langBtnText, language === 'lv' && styles.langBtnTextActive]}>
                        🇱🇻 {t('language.latvian')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}
              <Text style={styles.title}>{mode === 'signIn' ? t('auth.welcomeBack') : t('auth.createAccount')}</Text>
              <Text style={styles.subtitle}>
                {mode === 'signIn' ? t('auth.signInManage') : t('auth.joinTeam')}
              </Text>

              <TextInput
                style={styles.input}
                placeholder={t('auth.email')}
                placeholderTextColor={COLORS.muted2}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                textContentType="emailAddress"
                value={email}
                onChangeText={setEmail}
              />
              <TextInput
                style={styles.input}
                placeholder={t('auth.password')}
                placeholderTextColor={COLORS.muted2}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
              {mode === 'signUp' ? (
                <TextInput
                  style={styles.input}
                  placeholder={t('auth.nicknamePlaceholder')}
                  placeholderTextColor={COLORS.muted2}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={nickname}
                  onChangeText={setNickname}
                />
              ) : null}

              {error ? <Text style={styles.error}>{error}</Text> : null}
              {message ? <Text style={styles.message}>{message}</Text> : null}

              <TouchableOpacity
                style={[styles.button, (submitting || authLoading) && styles.buttonDisabled]}
                onPress={handleEmailAuth}
                disabled={submitting || authLoading}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.buttonText}>
                    {mode === 'signIn' ? t('auth.signIn') : t('auth.createAccountCta')}
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.googleButton, (submitting || authLoading) && styles.buttonDisabled]}
                onPress={handleGoogle}
                disabled={submitting || authLoading}
              >
                {submitting ? (
                  <ActivityIndicator color={COLORS.text} />
                ) : (
                  <Text style={styles.googleText}>{t('auth.continueGoogle')}</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setMode(prev => (prev === 'signIn' ? 'signUp' : 'signIn'))}
                disabled={submitting || authLoading}
              >
                <Text style={styles.toggle}>
                  {mode === 'signIn'
                    ? t('auth.dontHaveAccount')
                    : t('auth.alreadyHaveAccount')}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </AuthShell>
  );
}

export default function LoginRoute() {
  return <AuthScreen initialMode="signIn" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glassCard: {
    width: '98%',
    backgroundColor: 'rgba(12,16,28,0.6)',
    borderColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderRadius: 24,
    padding: 32,
    marginBottom: 40,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 20 },
    elevation: 14,
  },
  langWrap: {
    marginBottom: 14,
  },
  langLabel: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  langRow: {
    flexDirection: 'row',
    gap: 8,
  },
  langBtn: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  langBtnActive: {
    borderColor: 'rgba(143, 180, 255, 0.46)',
    backgroundColor: 'rgba(143, 180, 255, 0.15)',
  },
  langBtnText: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
    fontWeight: '600',
  },
  langBtnTextActive: {
    color: '#E9F2FF',
  },
  title: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    color: COLORS.muted,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  input: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: COLORS.text,
    fontSize: 16,
    marginBottom: 12,
  },
  button: {
    backgroundColor: COLORS.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  googleButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    backgroundColor: COLORS.card2,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  googleText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  toggle: {
    color: COLORS.muted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 16,
  },
  error: {
    color: '#EF4444',
    fontSize: 14,
    textAlign: 'center',
    marginVertical: 8,
  },
  message: {
    color: '#22C55E',
    fontSize: 14,
    textAlign: 'center',
    marginVertical: 8,
  },
  note: {
    color: COLORS.muted2,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 16,
  },
});
