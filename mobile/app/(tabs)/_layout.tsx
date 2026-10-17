import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { colors } from '../../lib/theme';

const icon = (glyph: string) => ({ color }: { color: unknown }) => <Text style={{ color: color as string, fontSize: 18 }}>{glyph}</Text>;

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{
      headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text,
      tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border }, tabBarActiveTintColor: colors.chip,
    }}>
      <Tabs.Screen name="index" options={{ title: 'Ask', tabBarIcon: icon('?') }} />
      <Tabs.Screen name="history" options={{ title: 'History', tabBarIcon: icon('⏱') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('⚙') }} />
    </Tabs>
  );
}
