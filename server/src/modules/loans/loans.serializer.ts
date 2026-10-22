import { formatMinorAsDecimal } from '../../lib/money.js';
import type { LoanRow } from './loans.repository.js';

export interface LoanDto {
  id: string;
  friendName: string;
  /** Authoritative integer value. Clients should do arithmetic on this. */
  amountMinor: number;
  /** Convenience decimal string, e.g. "1250.50". Never a float. */
  amount: string;
  currency: string;
  dueDate: string;
  note: string | null;
  status: 'outstanding' | 'repaid';
  /** Derived server-side so every client agrees on what "overdue" means. */
  isOverdue: boolean;
  /** Negative when the due date has passed. */
  daysUntilDue: number;
  repaidAt: string | null;
  createdAt: string;
  updatedAt: string;
  receipt: { id: string; url: string; mimeType: string; sizeBytes: number } | null;
}

/**
 * The single place a database row becomes an API object.
 *
 * Centralising it means a column added to `loans` is not accidentally exposed,
 * and the snake_case/camelCase boundary is crossed exactly once.
 */
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
          // Relative path: the app prefixes its own API base URL, so the same
          // response works from a simulator, a device on the LAN, or a deploy.
          url: `/api/loans/${row.id}/receipt`,
          mimeType: row.receipt_mime_type!,
          sizeBytes: row.receipt_size_bytes!,
        }
      : null,
  };
}
