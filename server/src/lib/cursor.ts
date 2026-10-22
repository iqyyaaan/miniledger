/**
 * Opaque pagination cursors for keyset ("seek") pagination.
 *
 * The cursor is just the sort tuple — `dueDate|id` — base64url-encoded so it
 * is opaque to the client and survives being put in a URL. It is deliberately
 * *not* signed: it carries no authority. Every query that uses one is still
 * scoped to `user_id`, so a forged cursor can at most point at a different
 * page of the caller's own data.
 *
 * It lives here rather than in the repository so it is a pure function with no
 * database import — which is what lets it be unit-tested on its own.
 */

export interface LoanCursor {
  dueDate: string;
  id: string;
}

export function encodeCursor(dueDate: string, id: string): string {
  return Buffer.from(`${dueDate}|${id}`, 'utf8').toString('base64url');
}

/**
 * Returns `null` for anything that is not exactly `YYYY-MM-DD|<uuid>`.
 *
 * Validating the shape here means a malformed cursor becomes a clean 400
 * instead of reaching Postgres and failing a `::date`/`::uuid` cast, which
 * would surface as a 500.
 */
export function decodeCursor(cursor: string): LoanCursor | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const parts = decoded.split('|');
    if (parts.length !== 2) return null;

    const [dueDate, id] = parts as [string, string];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;

    return { dueDate, id };
  } catch {
    return null;
  }
}
