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

type Mode = 'signIn' | 'signUp';

type Props = {
  initialMode?: Mode;
};

export function AuthScreen({ initialMode = 'signIn' }: Props) {
  const router = useRouter();
  const { signInWithEmail, signUpWithEmail, signInWithGoogle, loading: authLoading } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<Mode>(initialMode);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      if (mode === 'signIn') {
        await signInWithEmail(sanitizedEmail, trimmedPassword);
        router.replace('/(tabs)');
      } else {
        const session = await signUpWithEmail(sanitizedEmail, trimmedPassword);
        if (session) {
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
    try {
      const session = await signInWithGoogle();
      if (!session) {
        setError('We could not complete Google sign-in. Please try again.');
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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.select({ ios: 'padding', android: undefined })}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Welcome to Latvian Floorball Fantasy</Text>
          <Text style={styles.subtitle}>
            {mode === 'signIn'
              ? 'Sign in to manage your squad.'
              : 'Create an account to get started.'}
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
          <Text style={styles.note}>
            Google OAuth uses the app scheme redirect: lvfloorball://auth/callback (also add the Expo
            Go URL in Supabase Auth settings).
          </Text>

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
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

export default function LoginRoute() {
  return <AuthScreen initialMode="signIn" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 96,
    paddingBottom: 48,
  },
  title: {
    color: COLORS.text,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    color: COLORS.muted,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
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
