import { Stack } from 'expo-router';
import { COLORS } from '../../src/theme/colors';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.bg },
      }}
    />
  );
}
