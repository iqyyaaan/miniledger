import { useQuery } from '@tanstack/react-query';
import { todayIso } from '@/lib/dates';
import { summaryApi } from '@/lib/endpoints';
import { queryKeys } from '@/lib/query-keys';

export function useSummary() {
  const asOf = todayIso();
  return useQuery({
    queryKey: queryKeys.summary(asOf),
    queryFn: () => summaryApi.get(asOf).then((r) => r.data),
    // The summary is cheap to recompute and changes whenever any loan does —
    // a short staleTime still lets switching screens avoid a redundant refetch.
    staleTime: 10_000,
  });
}
