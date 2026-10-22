import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useMarkRepaid } from '@/hooks/use-loans';
import { formatDaysUntilDue, formatIsoDate } from '@/lib/dates';
import { formatMinorAsCurrency } from '@/lib/money';
import type { Loan } from '@/lib/api-types';
import { StatusPill } from '@/components/StatusPill';
import { useTheme } from '@/theme/colors';

export function LoanListItem({ loan }: { loan: Loan }) {
  const { colors } = useTheme();
  const router = useRouter();
  const markRepaid = useMarkRepaid();

  // No local "just marked" flag needed: the optimistic cache update in
  // useMarkRepaid flips `loan.status` to 'repaid' immediately, which
  // re-renders this row with the button already hidden below.
  const handleMarkRepaid = () => {
    markRepaid.mutate(loan.id, {
      onSuccess: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    });
  };

  const dueSoon = loan.status === 'outstanding' && !loan.isOverdue && loan.daysUntilDue <= 7;

  return (
    <Pressable
      onPress={() => router.push(`/loan/${loan.id}`)}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.9 : 1 },
        loan.isOverdue && { borderColor: colors.danger, borderLeftWidth: 4 },
      ]}
    >
      <View style={styles.main}>
        <View style={styles.topLine}>
          <Text style={[styles.friendName, { color: colors.text }]} numberOfLines={1}>
            {loan.friendName}
          </Text>
          <Text style={[styles.amount, { color: colors.text }]} numberOfLines={1}>
            {formatMinorAsCurrency(loan.amountMinor, loan.currency)}
          </Text>
        </View>

        <View style={styles.bottomLine}>
          <View style={styles.badges}>
            {loan.status === 'repaid' ? (
              <StatusPill label="Repaid" tone="success" />
            ) : loan.isOverdue ? (
              <StatusPill label={formatDaysUntilDue(loan.daysUntilDue)} tone="danger" />
            ) : dueSoon ? (
              <StatusPill label={formatDaysUntilDue(loan.daysUntilDue)} tone="warning" />
            ) : (
              <StatusPill label={formatIsoDate(loan.dueDate)} tone="neutral" />
            )}
            {loan.note ? (
              <Text style={[styles.note, { color: colors.textMuted }]} numberOfLines={1}>
                {loan.note}
              </Text>
            ) : null}
          </View>

          {loan.status === 'outstanding' ? (
            <Pressable
              onPress={handleMarkRepaid}
              disabled={markRepaid.isPending}
              hitSlop={8}
              style={[styles.repayButton, { backgroundColor: colors.successSoft }]}
            >
              {markRepaid.isPending ? (
                <ActivityIndicator size="small" color={colors.success} />
              ) : (
                <Text style={[styles.repayLabel, { color: colors.success }]}>Mark repaid</Text>
              )}
            </Pressable>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  main: { gap: 8 },
  topLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  friendName: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  amount: { fontSize: 16, fontWeight: '700' },
  bottomLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, flexShrink: 1 },
  note: { fontSize: 12.5, flexShrink: 1 },
  repayButton: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  repayLabel: { fontSize: 12, fontWeight: '700' },
});
