import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import AuthScreen from './auth';
import { getSupabaseClient, isSupabaseConfigured } from '../src/lib/supabaseClient';
import { COLORS } from '../src/theme/colors';

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
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          height: 72,
          paddingBottom: 12,
          paddingTop: 8,
          backgroundColor: COLORS.card,
          borderTopWidth: 1,
          borderTopColor: COLORS.border,
        },
        tabBarActiveTintColor: COLORS.accent,
        tabBarInactiveTintColor: COLORS.muted2,
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
        tabBarIcon: ({ color, focused, size }) => {
          const iconSize = size ? size + 2 : 22;
          const name = (() => {
            if (route.name === 'index') return focused ? 'home' : 'home-outline';
            if (route.name === 'squad') return focused ? 'grid' : 'grid-outline';
            if (route.name === 'profile') return focused ? 'person' : 'person-outline';
            return 'ellipse-outline';
          })();
          return <Ionicons name={name as any} color={color} size={iconSize} style={{ marginTop: 2 }} />;
        },
      })}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
        }}
      />
      <Tabs.Screen
        name="squad"
        options={{
          title: 'Squad',
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
        }}
      />
      <Tabs.Screen
        name="profile/[id]"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="squad-builder"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="build-team"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="my-points"
        options={{
          title: 'My Points',
          href: null,
        }}
      />
      <Tabs.Screen
        name="auth"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="player-points/[playerId]"
        options={{
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
  errorText: {
    color: '#EF4444',
    fontSize: 16,
    textAlign: 'center',
  },
});
