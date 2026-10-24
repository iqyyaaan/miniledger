import DateTimePicker from '@react-native-community/datetimepicker';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';
import { formatIsoDate, isoDatePlusDays, todayIso, toIsoDate } from '@/lib/dates';
import { useTheme } from '@/theme/colors';

const QUICK_PICKS: { label: string; days: number }[] = [
  { label: 'Today', days: 0 },
  { label: 'In a week', days: 7 },
  { label: 'In a month', days: 30 },
];

export function DueDateField({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const { colors } = useTheme();
  const [showPicker, setShowPicker] = useState(false);
  const today = todayIso();

  const handleNativeChange = (event: { type: string }, date?: Date) => {
    // Android's dialog fires once and closes itself. iOS's inline spinner
    // keeps firing on every scroll, so it needs to stay open until "Done".
    if (Platform.OS === 'android') setShowPicker(false);
    if (event.type === 'set' && date) onChange(toIsoDate(date));
  };

  return (
    <View style={styles.container}>
      <View style={styles.chipRow}>
        {QUICK_PICKS.map((pick) => {
          const target = isoDatePlusDays(today, pick.days);
          const active = value === target;
          return (
            <Pressable
              key={pick.label}
              onPress={() => onChange(target)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? colors.primary : colors.surfaceAlt,
                  borderColor: active ? colors.primary : colors.border,
                },
              ]}
            >
              <Text style={[styles.chipLabel, { color: active ? colors.primaryText : colors.textMuted }]}>
                {pick.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        onPress={() => setShowPicker(true)}
        style={[styles.customRow, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
      >
        <Text style={[styles.customLabel, { color: colors.textMuted }]}>Due date</Text>
        <Text style={[styles.customValue, { color: colors.text }]}>{formatIsoDate(value)}</Text>
      </Pressable>

      {showPicker ? (
        <>
          <DateTimePicker
            value={new Date(`${value}T12:00:00`)}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onChange={handleNativeChange}
            minimumDate={new Date(`${today}T00:00:00`)}
          />
          {Platform.OS === 'ios' ? (
            <Pressable onPress={() => setShowPicker(false)} style={styles.doneButton}>
              <Text style={[styles.doneLabel, { color: colors.primary }]}>Done</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
  chipLabel: { fontSize: 12.5, fontWeight: '600' },
  customRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  customLabel: { fontSize: 13, fontWeight: '600' },
  customValue: { fontSize: 14.5, fontWeight: '700' },
  doneButton: { alignSelf: 'flex-end', padding: 8 },
  doneLabel: { fontSize: 14, fontWeight: '700' },
});
