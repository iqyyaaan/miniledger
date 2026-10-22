import { DUE_SOON_WINDOW_DAYS } from './config';
import type { Loan, LoanStatusFilter } from './api-types';

/**
 * Client-side mirror of the `WHERE` logic in `loans.repository.ts#listLoans`.
 *
 * Needed for optimistic cache updates: after marking a loan repaid, every
 * *other* open filter tab's cached list (overdue, due-soon, all, ...) needs
 * to decide — without a round-trip — whether that loan still belongs in it.
 */
export function loanMatchesStatus(loan: Loan, status: LoanStatusFilter): boolean {
  switch (status) {
    case 'all':
      return true;
    case 'outstanding':
      return loan.status === 'outstanding';
    case 'repaid':
      return loan.status === 'repaid';
    case 'overdue':
      return loan.isOverdue;
    case 'due_soon':
      return loan.status === 'outstanding' && loan.daysUntilDue >= 0 && loan.daysUntilDue <= DUE_SOON_WINDOW_DAYS;
  }
}
