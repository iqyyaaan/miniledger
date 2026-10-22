import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="add" options={{ presentation: 'modal', title: 'Add entry' }} />
      <Stack.Screen name="loan/[id]" options={{ presentation: 'modal', title: 'Entry' }} />
    </Stack>
  );
}
