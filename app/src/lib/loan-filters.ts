import { DUE_SOON_WINDOW_DAYS } from './config';
import type { Loan, LoanStatusFilter } from './api-types';

// client-side mirror of the WHERE logic in loans.repository.ts#listLoans.
// needed for the optimistic cache updates — after marking something repaid,
// every OTHER open filter tab (overdue, due-soon, all, ...) has to decide,
// without a round-trip, whether that loan still belongs on its list.
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
