import { Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import AuthScreen from './auth';
import { getSupabaseClient, isSupabaseConfigured } from '../src/lib/supabaseClient';

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setConfigError(
        'Supabase environment variables are missing. Update your .env file to enable authentication.'
      );
      setInitializing(false);
      return;
    }

    const supabase = getSupabaseClient();
    let isMounted = true;

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          setConfigError(error.message);
        } else {
          setSession(data.session ?? null);
        }
        setInitializing(false);
      })
      .catch(err => {
        if (!isMounted) return;
        setConfigError(err.message ?? 'Failed to load session.');
        setInitializing(false);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  if (initializing) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#FF6B00" />
        <Text style={styles.loadingText}>Loading account…</Text>
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

  if (!session) {
    return <AuthScreen />;
  }

  return (
    <Tabs>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <Text style={[styles.tabIcon, { color }]}>🏠</Text>, // Emoji icons are MVP placeholders per 04_UI_UX.md
        }}
      />
      <Tabs.Screen
        name="players"
        options={{
          title: 'Players',
          tabBarIcon: ({ color }) => <Text style={[styles.tabIcon, { color }]}>🧑‍🤝‍🧑</Text>,
        }}
      />
      <Tabs.Screen
        name="squad"
        options={{
          title: 'Squad',
          tabBarIcon: ({ color }) => <Text style={[styles.tabIcon, { color }]}>⚙️</Text>,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <Text style={[styles.tabIcon, { color }]}>👤</Text>,
        }}
      />
      <Tabs.Screen
        name="my-points"
        options={{
          title: 'My Points',
          href: null,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  loadingText: {
    color: '#CBD5E1',
    marginTop: 12,
    fontSize: 16,
  },
  tabIcon: {
    fontSize: 18,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 16,
    textAlign: 'center',
  },
});
