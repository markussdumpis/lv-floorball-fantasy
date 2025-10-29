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
import { signIn, signUp } from '../src/lib/auth';
import { looksLikeEmail, sanitizeEmail } from '../src/utils/email';

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async () => {
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

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      console.log(
        'EMAIL_DEBUG',
        JSON.stringify(sanitizedEmail),
        [...sanitizedEmail].map(char => char.charCodeAt(0))
      );
      if (mode === 'signIn') {
        const { error: signInError } = await signIn(sanitizedEmail, trimmedPassword);
        if (signInError) {
          setError(signInError.message);
        }
      } else {
        const { error: signUpError } = await signUp(sanitizedEmail, trimmedPassword);
        if (signUpError) {
          setError(signUpError.message);
        } else {
          setMessage('Account created. You can sign in with your credentials now.');
        }
      }
    } catch (e: any) {
      setError(e.message ?? 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.select({ ios: 'padding', android: undefined })}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>Welcome to Latvian Floorball Fantasy</Text>
          <Text style={styles.subtitle}>
            {mode === 'signIn'
              ? 'Sign in to manage your squad.'
              : 'Create an account to get started.'}
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#94A3B8"
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
            placeholderTextColor="#94A3B8"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {message ? <Text style={styles.message}>{message}</Text> : null}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.buttonText}>
                {mode === 'signIn' ? 'Sign In' : 'Create Account'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setMode(prev => (prev === 'signIn' ? 'signUp' : 'signIn'))}
            disabled={loading}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1E293B',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 96,
    paddingBottom: 48,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    color: '#CBD5E1',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
  },
  input: {
    backgroundColor: '#2D3748',
    borderColor: '#4A5568',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#F8FAFC',
    fontSize: 16,
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#FF6B00',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
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
    color: '#94A3B8',
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
});
