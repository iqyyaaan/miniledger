import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useFriends } from '@/hooks/use-loans';
import { formatMinorAsCurrency } from '@/lib/money';
import { useTheme } from '@/theme/colors';

/** Suggests friends the user has already lent to, so repeat entries take one tap. */
export function FriendSuggestions({ query, onPick }: { query: string; onPick: (name: string) => void }) {
  const { colors } = useTheme();
  const { data: friends } = useFriends();

  if (!friends || friends.length === 0) return null;

  const needle = query.trim().toLowerCase();
  const matches = (needle ? friends.filter((f) => f.name.toLowerCase().includes(needle)) : friends).slice(0, 6);

  // Don't suggest the name the user already typed exactly.
  if (matches.length === 0 || (matches.length === 1 && matches[0]!.name.toLowerCase() === needle)) return null;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {matches.map((friend) => (
        <TouchableOpacity
          key={friend.name}
          onPress={() => onPick(friend.name)}
          style={[styles.chip, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
        >
          <Text style={[styles.name, { color: colors.text }]}>{friend.name}</Text>
          {friend.outstandingMinor > 0 ? (
            <Text style={[styles.sub, { color: colors.textMuted }]}>
              owes {formatMinorAsCurrency(friend.outstandingMinor)}
            </Text>
          ) : null}
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingVertical: 2 },
  chip: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7, gap: 1 },
  name: { fontSize: 13, fontWeight: '700' },
  sub: { fontSize: 10.5 },
});
