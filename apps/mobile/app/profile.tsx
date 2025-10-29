import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getSupabaseClient } from '../src/lib/supabaseClient';
import { signOut } from '../src/lib/auth';

export default function Profile() {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const supabase = getSupabaseClient();

    supabase.auth
      .getUser()
      .then(({ data, error: err }) => {
        if (!isMounted) return;
        if (err) {
          setError(err.message);
        } else {
          setEmail(data.user?.email ?? null);
        }
        setLoading(false);
      })
      .catch(e => {
        if (!isMounted) return;
        setError(e.message ?? 'Failed to load profile.');
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (e: any) {
      setError(e.message ?? 'Sign out failed.');
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#FF6B00" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Account</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.label}>Email</Text>
        <Text style={styles.value}>{email ?? 'Unknown user'}</Text>
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1E293B',
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  card: {
    backgroundColor: '#2D3748',
    borderRadius: 12,
    padding: 24,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 16,
  },
  label: {
    color: '#94A3B8',
    fontSize: 14,
    marginBottom: 4,
  },
  value: {
    color: '#F8FAFC',
    fontSize: 16,
    marginBottom: 24,
  },
  signOutButton: {
    backgroundColor: '#FF6B00',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  signOutText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: '#EF4444',
    fontSize: 14,
    marginBottom: 12,
  },
});
