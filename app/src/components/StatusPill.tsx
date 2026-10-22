import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme/colors';

type Tone = 'danger' | 'warning' | 'success' | 'neutral';

export function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  const { colors } = useTheme();

  const backgroundFor: Record<Tone, string> = {
    danger: colors.dangerSoft,
    warning: colors.warningSoft,
    success: colors.successSoft,
    neutral: colors.surfaceAlt,
  };
  const textFor: Record<Tone, string> = {
    danger: colors.danger,
    warning: colors.warning,
    success: colors.success,
    neutral: colors.textMuted,
  };

  return (
    <View style={[styles.pill, { backgroundColor: backgroundFor[tone] }]}>
      <Text style={[styles.label, { color: textFor[tone] }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  label: { fontSize: 12, fontWeight: '700' },
});
