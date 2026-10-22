import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { EmptyState } from '@/components/EmptyState';
import { FilterChips } from '@/components/FilterChips';
import { LoanListItem } from '@/components/LoanListItem';
import { Screen } from '@/components/Screen';
import { SummaryCard } from '@/components/SummaryCard';
import { useAuth } from '@/hooks/use-auth';
import { useLoansList } from '@/hooks/use-loans';
import { useSummary } from '@/hooks/use-summary';
import type { Loan, LoanStatusFilter } from '@/lib/api-types';
import { useTheme } from '@/theme/colors';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

export default function LedgerScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { session, logout } = useAuth();

  const [status, setStatus] = useState<LoanStatusFilter>('outstanding');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);

  const summary = useSummary();
  const loans = useLoansList(status, debouncedSearch);

  const rows = useMemo<Loan[]>(() => loans.data?.pages.flatMap((page) => page.data) ?? [], [loans.data]);

  const handleRefresh = () => {
    void summary.refetch();
    void loans.refetch();
  };

  const name = session.status === 'signedIn' ? session.user.displayName : null;

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.greeting, { color: colors.textMuted }]}>
            {name ? `Hi, ${name.split(' ')[0]}` : 'MiniLedger'}
          </Text>
          <Text style={[styles.title, { color: colors.text }]}>Your ledger</Text>
        </View>
        <Pressable onPress={() => void logout()} hitSlop={10} style={styles.logoutButton}>
          <Ionicons name="log-out-outline" size={22} color={colors.textMuted} />
        </Pressable>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(loan) => loan.id}
        renderItem={({ item }) => <LoanListItem loan={item} />}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={summary.isRefetching && loans.isRefetching} onRefresh={handleRefresh} />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (loans.hasNextPage && !loans.isFetchingNextPage) void loans.fetchNextPage();
        }}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <SummaryCard summary={summary.data} loading={summary.isLoading} />

            <View style={[styles.searchRow, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <Ionicons name="search" size={16} color={colors.textFaint} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search friend or note"
                placeholderTextColor={colors.textFaint}
                style={[styles.searchInput, { color: colors.text }]}
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
            </View>

            <FilterChips value={status} onChange={setStatus} />
          </View>
        }
        ListFooterComponent={
          loans.isFetchingNextPage ? (
            <ActivityIndicator style={styles.footerSpinner} color={colors.primary} />
          ) : undefined
        }
        ListEmptyComponent={
          loans.isLoading ? (
            <ActivityIndicator style={styles.footerSpinner} color={colors.primary} />
          ) : (
            <EmptyState
              icon={debouncedSearch ? 'search-outline' : 'receipt-outline'}
              title={emptyTitleFor(status, Boolean(debouncedSearch))}
              subtitle={
                debouncedSearch
                  ? 'Try a different name or note.'
                  : 'Tap the + button to log the first one.'
              }
            />
          )
        }
      />

      <Pressable
        onPress={() => router.push('/add')}
        style={[styles.fab, { backgroundColor: colors.primary }]}
        accessibilityLabel="Add entry"
      >
        <Ionicons name="add" size={28} color={colors.primaryText} />
      </Pressable>
    </Screen>
  );
}

function emptyTitleFor(status: LoanStatusFilter, searching: boolean): string {
  if (searching) return 'No matches';
  switch (status) {
    case 'overdue':
      return 'Nothing overdue';
    case 'due_soon':
      return 'Nothing due soon';
    case 'repaid':
      return 'Nothing repaid yet';
    case 'outstanding':
      return 'All settled up';
    default:
      return 'No entries yet';
  }
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  greeting: { fontSize: 13, fontWeight: '600' },
  title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  logoutButton: { padding: 6, marginTop: 4 },
  listContent: { paddingHorizontal: 20, paddingBottom: 100 },
  listHeader: { gap: 16, paddingTop: 12, paddingBottom: 16 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
  },
  searchInput: { flex: 1, fontSize: 14.5 },
  footerSpinner: { marginVertical: 24 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 28,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
});
