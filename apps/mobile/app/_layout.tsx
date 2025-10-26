import { Tabs } from 'expo-router';

export default function RootLayout() {
  return (
    <Tabs>
      <Tabs.Screen 
        name="index" 
        options={{ 
          title: 'Home',
          tabBarIcon: ({ color }) => '🏠'
        }} 
      />
      <Tabs.Screen 
        name="players" 
        options={{ 
          title: 'Players',
          tabBarIcon: ({ color }) => '🧑‍🤝‍🧑'
        }} 
      />
      <Tabs.Screen 
        name="squad" 
        options={{ 
          title: 'Squad',
          tabBarIcon: ({ color }) => '⚙️'
        }} 
      />
      <Tabs.Screen 
        name="profile" 
        options={{ 
          title: 'Profile',
          tabBarIcon: ({ color }) => '👤'
        }} 
      />
    </Tabs>
  );
}

