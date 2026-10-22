/**
 * The app sends its own notion of "today" as `asOf` on every request where it
 * matters (listing, fetching a loan, the summary). That is what lets
 * `isOverdue` agree with what the user is actually looking at on their own
 * device's calendar, rather than the server process's timezone — see the
 * `asOf` parameter on the API (loans.schemas.ts / summary.service.ts).
 */
export function todayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** `"2026-11-15"` -> `"15 Nov 2026"`. Parsed as a calendar date, not a UTC instant. */
export function formatIsoDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** `-3 -> "3 days overdue"`, `0 -> "Due today"`, `5 -> "Due in 5 days"`. */
export function formatDaysUntilDue(daysUntilDue: number): string {
  if (daysUntilDue === 0) return 'Due today';
  if (daysUntilDue === 1) return 'Due tomorrow';
  if (daysUntilDue === -1) return '1 day overdue';
  if (daysUntilDue < 0) return `${Math.abs(daysUntilDue)} days overdue`;
  return `Due in ${daysUntilDue} days`;
}

/** `YYYY-MM-DD` for a `Date`, in local time — used to seed a date picker. */
export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isoDatePlusDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year!, month! - 1, day!);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}
