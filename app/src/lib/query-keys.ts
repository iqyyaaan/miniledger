import type { LoanStatusFilter } from './api-types';

/**
 * Centralised so a mutation that needs to invalidate "every loans list
 * regardless of filter" can match on the `['loans', 'list']` prefix without
 * every call site re-deriving that shape.
 */
export const queryKeys = {
  summary: (asOf: string) => ['summary', asOf] as const,
  loansListRoot: ['loans', 'list'] as const,
  loansList: (status: LoanStatusFilter, search: string, asOf: string) =>
    ['loans', 'list', status, search, asOf] as const,
  loan: (id: string, asOf: string) => ['loans', 'detail', id, asOf] as const,
  friends: ['loans', 'friends'] as const,
};
