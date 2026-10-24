// runs before any test module gets imported. src/config/env.ts reads
// process.env right at import time and will exit the process if anything's
// missing — so this has to happen first, or just importing a module under
// test kills the whole test runner.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET ??= 'test-secret-that-is-definitely-long-enough-32';
process.env.APP_TIMEZONE ??= 'Asia/Kolkata';
process.env.DEFAULT_CURRENCY ??= 'INR';
process.env.DEFAULT_COUNTRY_CODE ??= '+91';
process.env.OTP_ECHO_IN_RESPONSE ??= 'true';

// points at the db-test service in docker-compose.yml (port 5433) — tmpfs
// backed, so data never outlives the container, and the database you're
// actually demoing against never gets touched by a test run
process.env.DATABASE_URL ??=
  'postgresql://miniledger:miniledger@localhost:5433/miniledger_test';

process.env.UPLOAD_DIR ??= 'tests/.tmp-uploads';
