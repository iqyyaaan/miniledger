import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/colors';

interface ScreenProps {
  children: ReactNode;
  edges?: Edge[];
  padded?: boolean;
}

export function Screen({ children, edges = ['top', 'bottom'], padded = false }: ScreenProps) {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={edges} style={[styles.base, { backgroundColor: colors.background }]}>
      <View style={[styles.inner, padded && styles.padded]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  base: { flex: 1 },
  inner: { flex: 1 },
  padded: { paddingHorizontal: 20 },
});
