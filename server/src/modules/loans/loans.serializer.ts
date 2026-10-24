import { formatMinorAsDecimal } from '../../lib/money.js';
import type { LoanRow } from './loans.repository.js';

export interface LoanDto {
  id: string;
  friendName: string;
  amountMinor: number; // the real value — clients should do math on this one
  amount: string; // display convenience, e.g. "1250.50" — never a float under the hood
  currency: string;
  dueDate: string;
  note: string | null;
  status: 'outstanding' | 'repaid';
  isOverdue: boolean; // computed server-side so every client agrees on what "overdue" means
  daysUntilDue: number; // negative once the due date's passed
  repaidAt: string | null;
  createdAt: string;
  updatedAt: string;
  receipt: { id: string; url: string; mimeType: string; sizeBytes: number } | null;
}

// the one place a DB row turns into an API response object. keeping it
// centralized means a new column added to `loans` doesn't leak out by
// accident, and the snake_case/camelCase crossing only happens once
export function toLoanDto(row: LoanRow): LoanDto {
  return {
    id: row.id,
    friendName: row.friend_name,
    amountMinor: row.amount_minor,
    amount: formatMinorAsDecimal(row.amount_minor, row.currency),
    currency: row.currency,
    dueDate: row.due_date,
    note: row.note,
    status: row.status,
    isOverdue: row.is_overdue,
    daysUntilDue: row.days_until_due,
    repaidAt: row.repaid_at ? row.repaid_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    receipt: row.receipt_id
      ? {
          id: row.receipt_id,
          // relative path on purpose — the app prefixes its own API base
          // url, so this same response works whether it's hitting a
          // simulator, a phone on the LAN, or a real deployment
          url: `/api/loans/${row.id}/receipt`,
          mimeType: row.receipt_mime_type!,
          sizeBytes: row.receipt_size_bytes!,
        }
      : null,
  };
}
