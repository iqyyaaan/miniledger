import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { todayIso } from '@/lib/dates';
import { type CreateLoanInput, loansApi } from '@/lib/endpoints';
import type { Loan, LoanListResponse, LoanStatusFilter } from '@/lib/api-types';
import { loanMatchesStatus } from '@/lib/loan-filters';
import { queryKeys } from '@/lib/query-keys';

const PAGE_SIZE = 20;

export function useLoansList(status: LoanStatusFilter, search: string) {
  const asOf = todayIso();

  return useInfiniteQuery({
    queryKey: queryKeys.loansList(status, search, asOf),
    queryFn: ({ pageParam }) =>
      loansApi.list({ status, search: search || undefined, asOf, limit: PAGE_SIZE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
    staleTime: 10_000,
  });
}

export function useLoan(id: string | undefined) {
  const asOf = todayIso();
  return useQuery({
    queryKey: queryKeys.loan(id ?? '', asOf),
    queryFn: () => loansApi.get(id!, asOf).then((r) => r.data),
    enabled: Boolean(id),
  });
}

export function useFriends() {
  return useQuery({
    queryKey: queryKeys.friends,
    queryFn: () => loansApi.friends().then((r) => r.data),
    staleTime: 60_000,
  });
}

type ListCache = InfiniteData<LoanListResponse>;

function invalidateAfterMutation(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.loansListRoot });
  void queryClient.invalidateQueries({ queryKey: ['summary'] });
}

/**
 * Every cached loans list, with the filter it represents recovered from its
 * own query key (`['loans', 'list', status, search, asOf]`).
 *
 * This loops and calls `setQueryData` per query rather than the single-pass
 * `setQueriesData`, because `setQueriesData`'s updater only ever receives the
 * *data* — not the key — so there is no way to ask "which status filter is
 * this page?" from inside it. Each cached list needs that answer to decide
 * whether an updated loan still belongs on it.
 */
type ListSnapshot = [readonly unknown[], ListCache | undefined][];

function forEachLoansListQuery(
  queryClient: QueryClient,
  mutate: (status: LoanStatusFilter, data: ListCache) => ListCache,
): ListSnapshot {
  const matches = queryClient.getQueriesData<ListCache>({ queryKey: queryKeys.loansListRoot });
  const snapshot: ListSnapshot = [];

  for (const [key, data] of matches) {
    snapshot.push([key, data]);
    if (!data) continue;
    const status = key[2] as LoanStatusFilter;
    queryClient.setQueryData(key, mutate(status, data));
  }

  return snapshot;
}

function restoreLoansListQueries(queryClient: QueryClient, snapshot: ListSnapshot): void {
  for (const [key, data] of snapshot) queryClient.setQueryData(key, data);
}

export function useCreateLoan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLoanInput) => loansApi.create(input).then((r) => r.data),
    onSuccess: () => invalidateAfterMutation(queryClient),
  });
}

export function useUpdateLoan(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<CreateLoanInput>) => loansApi.update(id, patch).then((r) => r.data),
    onSuccess: (loan) => {
      queryClient.setQueryData(queryKeys.loan(id, todayIso()), loan);
      invalidateAfterMutation(queryClient);
    },
  });
}

export function useDeleteLoan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => loansApi.remove(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.loansListRoot });
      const previous = forEachLoansListQuery(queryClient, (_status, data) => removeLoanFromPages(data, id));
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context) restoreLoansListQueries(queryClient, context.previous);
    },
    onSettled: () => invalidateAfterMutation(queryClient),
  });
}

/**
 * Mark repaid / undo share one implementation: both are "replace this loan
 * everywhere it's cached with a server-shaped guess, then reconcile." The
 * guess is optimistic — applied instantly, before the request resolves — and
 * rolled back onError using the snapshot taken in onMutate.
 */
function useSetRepaidState(markRepaid: boolean) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => {
      const asOf = todayIso();
      return (markRepaid ? loansApi.markRepaid(id, asOf) : loansApi.undoRepaid(id, asOf)).then((r) => r.data);
    },
    onMutate: async (id: string) => {
      const asOf = todayIso();
      await Promise.all([
        queryClient.cancelQueries({ queryKey: queryKeys.loansListRoot }),
        queryClient.cancelQueries({ queryKey: queryKeys.loan(id, asOf) }),
      ]);

      const previousDetail = queryClient.getQueryData<Loan>(queryKeys.loan(id, asOf));

      const applyOptimistic = (loan: Loan): Loan =>
        markRepaid
          ? { ...loan, status: 'repaid', isOverdue: false, repaidAt: new Date().toISOString() }
          : { ...loan, status: 'outstanding', repaidAt: null, isOverdue: loan.daysUntilDue < 0 };

      const previousLists = forEachLoansListQuery(queryClient, (status, data) =>
        updateLoanInPages(data, id, applyOptimistic, status),
      );
      if (previousDetail) queryClient.setQueryData(queryKeys.loan(id, asOf), applyOptimistic(previousDetail));

      return { previousLists, previousDetail, asOf };
    },
    onError: (_err, id, context) => {
      if (!context) return;
      restoreLoansListQueries(queryClient, context.previousLists);
      if (context.previousDetail) queryClient.setQueryData(queryKeys.loan(id, context.asOf), context.previousDetail);
    },
    onSuccess: (loan, id, context) => {
      // Replace the optimistic guess with the server's authoritative row.
      forEachLoansListQuery(queryClient, (status, data) => updateLoanInPages(data, id, () => loan, status));
      if (context) queryClient.setQueryData(queryKeys.loan(id, context.asOf), loan);
    },
    onSettled: () => invalidateAfterMutation(queryClient),
  });
}

export const useMarkRepaid = () => useSetRepaidState(true);
export const useUndoRepaid = () => useSetRepaidState(false);

export function useUploadReceipt(loanId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: { uri: string; name: string; mimeType: string }) => loansApi.uploadReceipt(loanId, file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.loan(loanId, todayIso()) });
    },
  });
}

export function useDeleteReceipt(loanId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => loansApi.deleteReceipt(loanId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.loan(loanId, todayIso()) });
    },
  });
}

// ---------------------------------------------------------------------------
// Pure cache-editing helpers (operate on one already-resolved ListCache)
// ---------------------------------------------------------------------------

function updateLoanInPages(
  data: ListCache,
  loanId: string,
  update: (loan: Loan) => Loan,
  status: LoanStatusFilter,
): ListCache {
  return {
    ...data,
    pages: data.pages.map((page) => {
      if (!page.data.some((loan) => loan.id === loanId)) return page;

      const nextLoans = page.data
        .map((loan) => (loan.id === loanId ? update(loan) : loan))
        // If the update means the loan no longer matches this list's filter
        // — e.g. marking something repaid removes it from "overdue" — drop it.
        .filter((loan) => (loan.id === loanId ? loanMatchesStatus(loan, status) : true));

      return { ...page, data: nextLoans, meta: { ...page.meta, count: nextLoans.length } };
    }),
  };
}

function removeLoanFromPages(data: ListCache, loanId: string): ListCache {
  return {
    ...data,
    pages: data.pages.map((page) => {
      if (!page.data.some((loan) => loan.id === loanId)) return page;
      const nextLoans = page.data.filter((loan) => loan.id !== loanId);
      return { ...page, data: nextLoans, meta: { ...page.meta, count: nextLoans.length } };
    }),
  };
}
