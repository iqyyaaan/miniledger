-- MiniLedger initial schema.
--
-- Design notes worth knowing before reading:
--   * Money lives in `amount_minor BIGINT` (paise, not rupees). No floats.
--   * "Overdue" is NOT a stored status. It is derived from
--     (status = 'outstanding' AND due_date < today), because a row that is
--     merely sitting in the table silently becomes overdue as the clock moves
--     past midnight. Storing it would mean a cron job to keep it honest.
--   * Secrets (OTPs, refresh tokens) are stored as SHA-256 digests only.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Keeps `updated_at` honest without the application having to remember.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Phone is normalised to E.164 by the app; the DB refuses anything else so a
  -- bad code path can't create a duplicate account under a second spelling.
  CONSTRAINT users_phone_is_e164 CHECK (phone ~ '^\+[1-9]\d{7,14}$')
);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- otp_codes — short-lived login challenges
-- ---------------------------------------------------------------------------
CREATE TABLE otp_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempts    INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT otp_codes_phone_is_e164 CHECK (phone ~ '^\+[1-9]\d{7,14}$')
);

-- Verification always asks for "the newest unconsumed code for this phone".
-- Partial index: only unconsumed rows are ever looked up, so spent codes don't
-- bloat the index.
CREATE INDEX otp_codes_active_idx
  ON otp_codes (phone, created_at DESC)
  WHERE consumed_at IS NULL;

-- Supports the per-phone send-rate check.
CREATE INDEX otp_codes_phone_created_idx ON otp_codes (phone, created_at DESC);

-- ---------------------------------------------------------------------------
-- refresh_tokens — rotating, one row per issued token
-- ---------------------------------------------------------------------------
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  -- Set when this token is rotated, so a replay of the old token is
  -- detectable rather than merely rejected.
  replaced_by UUID REFERENCES refresh_tokens (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- loans — the ledger itself
-- ---------------------------------------------------------------------------
CREATE TABLE loans (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  friend_name  TEXT NOT NULL CHECK (length(btrim(friend_name)) BETWEEN 1 AND 80),
  -- Generated, so grouping "Ravi" with "ravi " needs no application discipline.
  friend_key   TEXT GENERATED ALWAYS AS (lower(btrim(friend_name))) STORED,

  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency     CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),

  due_date     DATE NOT NULL,
  note         TEXT CHECK (note IS NULL OR length(note) <= 500),

  status       TEXT NOT NULL DEFAULT 'outstanding'
                 CHECK (status IN ('outstanding', 'repaid')),
  repaid_at    TIMESTAMPTZ,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The two fields must agree: repaid rows carry a timestamp, open rows don't.
  -- This is the invariant the whole summary depends on, so the database owns
  -- it rather than trusting every future code path to get it right.
  CONSTRAINT loans_repaid_consistency CHECK (
    (status = 'repaid'      AND repaid_at IS NOT NULL) OR
    (status = 'outstanding' AND repaid_at IS NULL)
  )
);

CREATE TRIGGER loans_set_updated_at
  BEFORE UPDATE ON loans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every list query is scoped to one user and sorted by due date.
CREATE INDEX loans_user_due_idx ON loans (user_id, due_date DESC, created_at DESC);
-- The overdue/outstanding filters only ever scan open rows.
CREATE INDEX loans_user_outstanding_idx
  ON loans (user_id, due_date)
  WHERE status = 'outstanding';
-- Friend-name autocomplete and per-friend grouping.
CREATE INDEX loans_user_friend_idx ON loans (user_id, friend_key);

-- ---------------------------------------------------------------------------
-- receipts — optional photo attached to a loan
-- ---------------------------------------------------------------------------
CREATE TABLE receipts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One receipt per loan; re-uploading replaces the row.
  loan_id       UUID NOT NULL UNIQUE REFERENCES loans (id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  storage_key   TEXT NOT NULL,
  mime_type     TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  size_bytes    INTEGER NOT NULL CHECK (size_bytes > 0),
  original_name TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX receipts_user_idx ON receipts (user_id);
