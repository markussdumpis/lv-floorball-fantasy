import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../src/theme/colors';

export default function TabsLayout() {
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
