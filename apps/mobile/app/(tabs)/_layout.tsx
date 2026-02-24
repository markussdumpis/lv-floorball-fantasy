import React, { useCallback, useRef } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Alert } from 'react-native';
import { COLORS } from '../../src/theme/colors';
import { getSquadUnsavedGuard } from '../../src/lib/squadUnsavedGuard';

export default function TabsLayout() {
  const tabPromptOpenRef = useRef(false);

  const handleProtectedTabPress = useCallback((event: any, navigation: any, targetRouteName: string) => {
    const state = navigation.getState();
    const currentRouteName = state?.routes?.[state.index]?.name;
    if (currentRouteName !== 'squad') return;

    const guard = getSquadUnsavedGuard();
    if (!guard?.isDirty) return;

    event.preventDefault();
    if (tabPromptOpenRef.current) return;
    tabPromptOpenRef.current = true;

    Alert.alert('Unsaved changes', 'You have unsaved squad changes. Save before leaving?', [
      {
        text: 'Stay',
        style: 'cancel',
        onPress: () => {
          tabPromptOpenRef.current = false;
        },
      },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          tabPromptOpenRef.current = false;
          void (async () => {
            await guard.discard();
            navigation.navigate(targetRouteName);
          })();
        },
      },
      {
        text: 'Save',
        onPress: () => {
          tabPromptOpenRef.current = false;
          void (async () => {
            const result = await guard.save();
            if (!result?.ok) {
              Alert.alert('Save failed', result?.error ?? 'Failed to save squad.');
              return;
            }
            navigation.navigate(targetRouteName);
          })();
        },
      },
    ]);
  }, []);

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
        tabBarActiveTintColor: COLORS.latvianMaroon,
        tabBarInactiveTintColor: 'rgba(255,255,255,0.45)',
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
        listeners={({ navigation, route }) => ({
          tabPress: event => {
            handleProtectedTabPress(event, navigation, route.name);
          },
        })}
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
        listeners={({ navigation, route }) => ({
          tabPress: event => {
            handleProtectedTabPress(event, navigation, route.name);
          },
        })}
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
        name="fixtures"
        options={{
          title: 'Fixtures',
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
