// opaque cursors for keyset pagination. the cursor is literally just the
// sort tuple (dueDate|id), base64url-encoded so it's opaque to the client
// and survives sitting in a URL. not signed on purpose — it carries no
// authority. every query using one is still scoped to user_id, so the worst
// a forged cursor can do is point at a different page of your OWN data.
//
// lives in its own file instead of the repository so it stays a pure
// function with zero DB import, which is what makes it unit-testable
// on its own without spinning up Postgres.

export interface LoanCursor {
  dueDate: string;
  id: string;
}

export function encodeCursor(dueDate: string, id: string): string {
  return Buffer.from(`${dueDate}|${id}`, 'utf8').toString('base64url');
}

// returns null for anything that isn't exactly YYYY-MM-DD|<uuid>. checking
// the shape here turns a malformed cursor into a clean 400 instead of
// letting it reach Postgres and blow up a ::date/::uuid cast as a 500.
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
