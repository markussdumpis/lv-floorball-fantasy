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

type Mode = 'signIn' | 'signUp';

type Props = {
  initialMode?: Mode;
};

export function AuthScreen({ initialMode = 'signIn' }: Props) {
  const router = useRouter();
  const { signInWithEmail, signUpWithEmail, signInWithGoogle, setNickname: setProfileNickname, setNicknameForUser, signOut, loading: authLoading } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<Mode>(initialMode);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');

  const handleEmailAuth = async () => {
    const sanitizedEmail = sanitizeEmail(email);
    const trimmedPassword = password.trim();

    if (!sanitizedEmail) {
      setError('Email is required.');
      return;
    }
    if (!trimmedPassword) {
      setError('Password is required.');
      return;
    }
    if (!looksLikeEmail(sanitizedEmail)) {
      setError('Please enter a valid email.');
      return;
    }

    const nicknameNeeded = mode === 'signUp';
    const trimmedNickname = nickname.trim();
    if (nicknameNeeded) {
      if (!trimmedNickname) {
        setError('Nickname is required.');
        return;
      }
      if (trimmedNickname.length < 3 || trimmedNickname.length > 20) {
        setError('Nickname must be 3-20 characters.');
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
        const session = await signUpWithEmail(sanitizedEmail, trimmedPassword);
        if (session?.user?.id) {
          if (nicknameNeeded) {
            try {
              await setNicknameForUser(session.user.id, trimmedNickname);
            } catch (nickErr: any) {
              setError(nickErr?.message ?? 'Failed to save nickname.');
              return;
            }
          }
          router.replace('/(tabs)');
        } else {
          setMessage('Account created. If email confirmation is required, check your inbox.');
        }
      }
    } catch (e: any) {
      setError(e.message ?? 'Authentication failed.');
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
        setError('We could not complete Google sign-in. Please try again.');
        return;
      }
      if (mode === 'signUp') {
        // If user is trying to sign up but the Google account already exists,
        // show a friendly message and keep them on the auth screen.
        if (nickname.trim().length < 3) {
          setError('Nickname is required to finish sign-up.');
          await signOut();
          return;
        }
        const nick = nickname.trim();
        try {
          await setNicknameForUser(session.user.id, nick);
        } catch (nickErr: any) {
          setError(nickErr?.message ?? 'Failed to save nickname.');
          await signOut();
          return;
        }
        router.replace('/(tabs)');
        return;
      }
      router.replace('/(tabs)');
    } catch (e: any) {
      setError(e.message ?? 'Google sign-in failed.');
    } finally {
      setSubmitting(false);
    }
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
              <Text style={styles.title}>{mode === 'signIn' ? 'Welcome back' : 'Create account'}</Text>
              <Text style={styles.subtitle}>
                {mode === 'signIn' ? 'Sign in to manage your squad.' : 'Join to build your fantasy team.'}
              </Text>

              <TextInput
                style={styles.input}
                placeholder="Email"
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
                placeholder="Password"
                placeholderTextColor={COLORS.muted2}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
              {mode === 'signUp' ? (
                <TextInput
                  style={styles.input}
                  placeholder="Nickname (3-20 chars)"
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
                    {mode === 'signIn' ? 'Sign In' : 'Create Account'}
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
                  <Text style={styles.googleText}>Continue with Google</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setMode(prev => (prev === 'signIn' ? 'signUp' : 'signIn'))}
                disabled={submitting || authLoading}
              >
                <Text style={styles.toggle}>
                  {mode === 'signIn'
                    ? "Don't have an account? Sign up"
                    : 'Already have an account? Sign in'}
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
