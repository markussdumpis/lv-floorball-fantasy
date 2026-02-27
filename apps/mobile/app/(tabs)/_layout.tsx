import React, { useCallback, useRef } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Alert } from 'react-native';
import { COLORS } from '../../src/theme/colors';
import { getSquadUnsavedGuard } from '../../src/lib/squadUnsavedGuard';
import { useTranslation } from 'react-i18next';

export default function TabsLayout() {
  const { t, i18n } = useTranslation();
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

    Alert.alert(t('common.unsavedChanges'), t('common.unsavedChangesBody'), [
      {
        text: t('common.stay'),
        style: 'cancel',
        onPress: () => {
          tabPromptOpenRef.current = false;
        },
      },
      {
        text: t('common.discard'),
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
        text: t('common.save'),
        onPress: () => {
          tabPromptOpenRef.current = false;
          void (async () => {
            const result = await guard.save();
            if (!result?.ok) {
              Alert.alert(t('errors.saveFailed'), result?.error ?? t('errors.failedToSaveSquad'));
              return;
            }
            navigation.navigate(targetRouteName);
          })();
        },
      },
    ]);
  }, [t]);

  return (
    <Tabs
      key={`tabs-${i18n.language}`}
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
          title: t('nav.home'),
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
          title: t('nav.squad'),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('nav.profile'),
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
          title: t('nav.myPoints'),
          href: null,
        }}
      />
      <Tabs.Screen
        name="fixtures"
        options={{
          title: t('nav.fixtures'),
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
