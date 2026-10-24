import type { LoanStatusFilter } from './api-types';

// kept in one place so a mutation that needs to invalidate "every loans
// list, whatever the filter" can just match on the ['loans', 'list'] prefix
// instead of every call site re-deriving the key shape itself
export const queryKeys = {
  summary: (asOf: string) => ['summary', asOf] as const,
  loansListRoot: ['loans', 'list'] as const,
  loansList: (status: LoanStatusFilter, search: string, asOf: string) =>
    ['loans', 'list', status, search, asOf] as const,
  loan: (id: string, asOf: string) => ['loans', 'detail', id, asOf] as const,
  friends: ['loans', 'friends'] as const,
};
