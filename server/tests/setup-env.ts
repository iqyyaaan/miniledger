/**
 * Runs before any test module is imported.
 *
 * `src/config/env.ts` reads `process.env` at import time and exits the process
 * if anything is missing, so these must be set first — otherwise importing a
 * module under test would kill the test runner.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET ??= 'test-secret-that-is-definitely-long-enough-32';
process.env.APP_TIMEZONE ??= 'Asia/Kolkata';
process.env.DEFAULT_CURRENCY ??= 'INR';
process.env.DEFAULT_COUNTRY_CODE ??= '+91';
process.env.OTP_ECHO_IN_RESPONSE ??= 'true';

// Points at the `db-test` service in docker-compose.yml (port 5433), which
// uses a tmpfs volume — so the data never outlives the container, and the
// database you are demoing against is never touched.
process.env.DATABASE_URL ??=
  'postgresql://miniledger:miniledger@localhost:5433/miniledger_test';

process.env.UPLOAD_DIR ??= 'tests/.tmp-uploads';
