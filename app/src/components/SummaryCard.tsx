import { StyleSheet, Text, View } from 'react-native';
import { formatMinorAsCurrency } from '@/lib/money';
import type { Summary } from '@/lib/api-types';
import { useTheme } from '@/theme/colors';

export function SummaryCard({ summary, loading }: { summary: Summary | undefined; loading: boolean }) {
  const { colors } = useTheme();

  if (loading || !summary) {
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={[styles.skeletonLine, { backgroundColor: colors.surfaceAlt, width: '50%', height: 28 }]} />
        <View style={[styles.skeletonLine, { backgroundColor: colors.surfaceAlt, width: '70%' }]} />
      </View>
    );
  }

  const { totals, counts, currency } = summary;
  const hasOverdue = totals.overdueMinor > 0;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.outstandingLabel, { color: colors.textMuted }]}>You&rsquo;re owed</Text>
      <Text style={[styles.outstandingValue, { color: colors.text }]}>
        {formatMinorAsCurrency(totals.outstandingMinor, currency)}
      </Text>

      {summary.repaidPercent !== null ? (
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.min(100, summary.repaidPercent)}%`, backgroundColor: colors.primary },
            ]}
          />
        </View>
      ) : null}

      <View style={styles.statRow}>
        <Stat label="Lent" value={formatMinorAsCurrency(totals.lentMinor, currency)} color={colors.text} />
        <Stat label="Repaid" value={formatMinorAsCurrency(totals.repaidMinor, currency)} color={colors.success} />
        <Stat
          label={`Overdue${counts.overdue > 0 ? ` · ${counts.overdue}` : ''}`}
          value={formatMinorAsCurrency(totals.overdueMinor, currency)}
          color={hasOverdue ? colors.danger : colors.textMuted}
        />
      </View>

      {counts.dueSoon > 0 ? (
        <View style={[styles.dueSoonBanner, { backgroundColor: colors.warningSoft }]}>
          <Text style={[styles.dueSoonText, { color: colors.warning }]}>
            {counts.dueSoon} {counts.dueSoon === 1 ? 'entry is' : 'entries are'} due within {summary.dueSoonWindowDays}{' '}
            days · {formatMinorAsCurrency(totals.dueSoonMinor, currency)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={[styles.statLabel, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: 1, padding: 20, gap: 14 },
  outstandingLabel: { fontSize: 13, fontWeight: '600' },
  outstandingValue: { fontSize: 34, fontWeight: '800', letterSpacing: -0.5 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(0,0,0,0.08)', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  stat: { flex: 1, gap: 2 },
  statValue: { fontSize: 16, fontWeight: '700' },
  statLabel: { fontSize: 12, fontWeight: '500' },
  dueSoonBanner: { borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 },
  dueSoonText: { fontSize: 12.5, fontWeight: '600' },
  skeletonLine: { height: 16, borderRadius: 8, marginTop: 4 },
});
