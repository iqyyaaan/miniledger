import 'dotenv/config';
import { z } from 'zod';

// env gets parsed once at boot through a schema — if something's missing or
// malformed the process just refuses to start with a readable message,
// instead of blowing up later as an `undefined` buried three calls deep
// into some request handler
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'), // signs access + refresh tokens
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  // when true, the OTP comes back in the request-otp response so the app
  // can autofill it during dev/demo. never flip this on in prod — it'd
  // literally hand out a login code for any phone number to anyone asking
  OTP_ECHO_IN_RESPONSE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // "overdue" is a calendar-day comparison, which only means anything
  // relative to a timezone. everything's stored in UTC — this is just the
  // zone we resolve "today" in.
  APP_TIMEZONE: z.string().default('Asia/Kolkata'),
  DEFAULT_CURRENCY: z.string().length(3).default('INR'),
  DEFAULT_COUNTRY_CODE: z.string().regex(/^\+\d{1,3}$/).default('+91'), // turns "9876543210" into "+919876543210"

  UPLOAD_DIR: z.string().default('uploads'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),

  CORS_ORIGIN: z.string().default('*'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  // eslint-disable-next-line no-console -- logger itself depends on env, can't use it here
  console.error(`\nInvalid environment configuration:\n${details}\n`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

if (isProduction && env.OTP_ECHO_IN_RESPONSE) {
  // eslint-disable-next-line no-console
  console.error('Refusing to start: OTP_ECHO_IN_RESPONSE must be false in production.');
  process.exit(1);
}
