import { z } from 'zod';
import { env } from '../../config/env.js';
import { MoneyParseError, parseAmountToMinor } from '../../lib/money.js';

// catches stuff like "2026-02-30" — plain `new Date(...)` would just roll
// that forward to March 2nd without complaining
const isRealCalendarDate = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(m) - 1 &&
    date.getUTCDate() === Number(d)
  );
};

export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.')
  .refine(isRealCalendarDate, 'That date does not exist.');

export const UuidSchema = z.string().uuid('Not a valid id.');

// takes 1500, "1500", "1,500.50", whatever — turns it into integer minor
// units right here at the edge, so nothing past this point ever has to
// think about decimals again
export const AmountSchema = z
  .union([z.number(), z.string()])
  .transform((value, ctx) => {
    try {
      return parseAmountToMinor(value, env.DEFAULT_CURRENCY);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof MoneyParseError ? error.message : 'Enter a valid amount.',
      });
      return z.NEVER;
    }
  });

export const FriendNameSchema = z
  .string({ required_error: "Enter your friend's name." })
  .trim()
  .min(1, "Enter your friend's name.")
  .max(80, 'That name is too long.');

export const NoteSchema = z
  .string()
  .trim()
  .max(500, 'Keep the note under 500 characters.')
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional();

export const CreateLoanSchema = z
  .object({
    friendName: FriendNameSchema,
    amount: AmountSchema,
    dueDate: IsoDateSchema,
    note: NoteSchema,
  })
  .strict();

// needs at least one field — an empty PATCH almost always means the client
// built the request wrong somewhere, and a silent 200 would just hide that
export const UpdateLoanSchema = z
  .object({
    friendName: FriendNameSchema.optional(),
    amount: AmountSchema.optional(),
    dueDate: IsoDateSchema.optional(),
    note: NoteSchema,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const ListLoansQuerySchema = z
  .object({
    status: z.enum(['all', 'outstanding', 'repaid', 'overdue', 'due_soon']).default('outstanding'),
    search: z.string().trim().min(1).max(80).optional(),
    friend: z.string().trim().min(1).max(80).optional(),
    order: z.enum(['asc', 'desc']).default('asc'),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().max(200).optional(),
    // the client's own idea of "today" — app sends its local date so
    // someone in a different timezone than the server still sees the right
    // rows highlighted as overdue. falls back to APP_TIMEZONE if omitted.
    asOf: IsoDateSchema.optional(),
  })
  .strict();

export const AsOfQuerySchema = z.object({ asOf: IsoDateSchema.optional() }).strict();

export const LoanIdParamsSchema = z.object({ id: UuidSchema });
