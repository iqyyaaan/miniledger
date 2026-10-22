import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import type { LoanStatusFilter } from '@/lib/api-types';
import { useTheme } from '@/theme/colors';

const FILTERS: { value: LoanStatusFilter; label: string }[] = [
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'due_soon', label: 'Due soon' },
  { value: 'repaid', label: 'Repaid' },
  { value: 'all', label: 'All' },
];

export function FilterChips({
  value,
  onChange,
}: {
  value: LoanStatusFilter;
  onChange: (next: LoanStatusFilter) => void;
}) {
  const { colors } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      keyboardShouldPersistTaps="handled"
    >
      {FILTERS.map((filter) => {
        const active = filter.value === value;
        return (
          <TouchableOpacity
            key={filter.value}
            onPress={() => onChange(filter.value)}
            style={[
              styles.chip,
              {
                backgroundColor: active ? colors.primary : colors.surfaceAlt,
                borderColor: active ? colors.primary : colors.border,
              },
            ]}
          >
            <Text style={[styles.label, { color: active ? colors.primaryText : colors.textMuted }]}>
              {filter.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingVertical: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, borderWidth: 1 },
  label: { fontSize: 13.5, fontWeight: '600' },
});
