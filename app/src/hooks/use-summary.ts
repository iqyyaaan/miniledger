import { useQuery } from '@tanstack/react-query';
import { todayIso } from '@/lib/dates';
import { summaryApi } from '@/lib/endpoints';
import { queryKeys } from '@/lib/query-keys';

export function useSummary() {
  const asOf = todayIso();
  return useQuery({
    queryKey: queryKeys.summary(asOf),
    queryFn: () => summaryApi.get(asOf).then((r) => r.data),
    // cheap to recompute and changes whenever any loan does — a short
    // staleTime just avoids a redundant refetch when switching screens
    staleTime: 10_000,
  });
}
